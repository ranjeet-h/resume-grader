import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pLimit from 'p-limit';
import type { CandidateMatchResult, PairFailure, ScoringInput } from '../domain/types.js';
import { classifyError, RetryExhaustedError } from '../providers/errors.js';
import type { CandidateEvaluator } from '../providers/evaluator.js';
import { withRetry } from '../providers/retry.js';
import { DEFAULT_MODEL_ID, RUBRIC_VERSION } from '../scoring/rubric.js';
import type { EvaluationCache } from './cache.js';

export interface BatchRunInput {
  dataset: string;
  datasetVersionOrHash: string;
  jobId?: string;
  pairs: ScoringInput[];
  evaluator: CandidateEvaluator;
  outputRoot: string;
  cache?: EvaluationCache;
  noCache?: boolean;
  stopOnFailure?: boolean;
  concurrency: number;
  maxRetries: number;
  onProgress?: (progress: BatchProgress) => void;
}

export interface BatchProgress {
  completed: number;
  total: number;
  successful: number;
  failed: number;
  cached: number;
}

export interface RunManifest {
  runId: string;
  startedAt: string;
  completedAt: string;
  model: string;
  rubricVersion: string;
  scoringConfigVersion: string;
  dataset: string;
  datasetVersionOrHash: string;
  jobId?: string;
  candidateCount: number;
  successfulCount: number;
  failedCount: number;
  cachedCount: number;
  liveRequestCount: number;
  retryCount: number;
  rateLimitCount: number;
  concurrency: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  providerReportedCostUsd?: number;
  modelPreflightReportPath?: string;
  latency: { p50: number; p95: number; p99: number; mean: number };
  elapsedMs: number;
}

export interface BatchRunResult {
  runId: string;
  runDir: string;
  results: CandidateMatchResult[];
  failures: PairFailure[];
  manifest: RunManifest;
}

export async function runBatch(input: BatchRunInput): Promise<BatchRunResult> {
  if (!Number.isInteger(input.concurrency) || input.concurrency < 1) {
    throw new RangeError('concurrency must be a positive integer');
  }
  const runId = createRunId();
  const runDir = path.join(input.outputRoot, 'runs', runId);
  await mkdir(runDir, { recursive: true, mode: 0o700 });
  const startedAt = new Date();
  const startClock = Date.now();
  const limit = pLimit(input.concurrency);
  let liveRequestCount = 0;
  let retryCount = 0;
  let rateLimitCount = 0;
  let cachedCount = 0;
  let successfulCount = 0;
  let failedCount = 0;
  let completedCount = 0;
  let stopScheduling = false;
  const latencies: number[] = [];

  const settled = await Promise.all(
    input.pairs.map((pair, index) =>
      limit(async () => {
        if (input.stopOnFailure && stopScheduling) {
          failedCount += 1;
          completedCount += 1;
          input.onProgress?.({
            completed: completedCount,
            total: input.pairs.length,
            successful: successfulCount,
            failed: failedCount,
            cached: cachedCount,
          });
          return {
            index,
            failure: {
              candidateId: pair.candidate.id,
              jobId: pair.job.id,
              errorType: 'skipped',
              retryable: false,
              attempts: 0,
              message: 'Not attempted because the local Laya run stopped after an earlier failure.',
            } satisfies PairFailure,
          } as const;
        }
        try {
          if (!input.noCache && input.cache) {
            const cached = await input.cache.get(pair);
            if (cached) {
              cachedCount += 1;
              successfulCount += 1;
              return { index, result: cached } as const;
            }
          }
          const result = await withRetry(
            async () => {
              liveRequestCount += 1;
              try {
                return await input.evaluator.evaluate(pair);
              } catch (error) {
                if (classifyError(error).errorType === 'rate_limit') rateLimitCount += 1;
                throw error;
              }
            },
            {
              maxRetries: input.maxRetries,
              onRetry: () => {
                retryCount += 1;
              },
            },
          );
          result.cached = false;
          latencies.push(result.latencyMs);
          if (!input.noCache && input.cache) await input.cache.set(pair, result);
          successfulCount += 1;
          return { index, result } as const;
        } catch (error) {
          const originalError = error instanceof RetryExhaustedError ? error.originalError : error;
          const classified = classifyError(originalError);
          const failure: PairFailure = {
            candidateId: pair.candidate.id,
            jobId: pair.job.id,
            errorType: classified.errorType,
            retryable: classified.retryable,
            attempts: error instanceof RetryExhaustedError ? error.attempts : 1,
            message: classified.message,
          };
          if (input.stopOnFailure) stopScheduling = true;
          failedCount += 1;
          return { index, failure } as const;
        } finally {
          completedCount += 1;
          input.onProgress?.({
            completed: completedCount,
            total: input.pairs.length,
            successful: successfulCount,
            failed: failedCount,
            cached: cachedCount,
          });
        }
      }),
    ),
  );

  const ordered = settled.sort((left, right) => left.index - right.index);
  const results = ordered.flatMap((entry) => ('result' in entry ? [entry.result] : []));
  const failures = ordered.flatMap((entry) => ('failure' in entry ? [entry.failure] : []));
  const completedAt = new Date();
  const manifest: RunManifest = {
    runId,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    model: input.cache?.modelId ?? results[0]?.model ?? DEFAULT_MODEL_ID,
    rubricVersion: results[0]?.rubricVersion ?? RUBRIC_VERSION,
    scoringConfigVersion: results[0]?.scoringConfigVersion ?? 'resume-match-weights-v1',
    dataset: input.dataset,
    datasetVersionOrHash: input.datasetVersionOrHash,
    candidateCount: input.pairs.length,
    successfulCount: results.length,
    failedCount: failures.length,
    cachedCount,
    liveRequestCount,
    retryCount,
    rateLimitCount,
    concurrency: input.concurrency,
    totalInputTokens: sum(results, (result) => result.usage?.inputTokens),
    totalOutputTokens: sum(results, (result) => result.usage?.outputTokens),
    latency: summarize(latencies),
    elapsedMs: Date.now() - startClock,
  };
  const providerCosts = results.flatMap((result) =>
    result.cached || result.usage?.costUsd === undefined ? [] : [result.usage.costUsd],
  );
  if (providerCosts.length > 0)
    manifest.providerReportedCostUsd = providerCosts.reduce((a, b) => a + b, 0);
  if (input.jobId) manifest.jobId = input.jobId;

  await writeJsonLines(path.join(runDir, 'results.jsonl'), results);
  await writeJsonLines(path.join(runDir, 'failures.jsonl'), failures);
  await writeJsonLines(
    path.join(runDir, 'retry.jsonl'),
    failures.filter((failure) => failure.retryable),
  );
  await writeFile(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2), {
    mode: 0o600,
  });
  return { runId, runDir, results, failures, manifest };
}

function createRunId(): string {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
}

async function writeJsonLines(filePath: string, rows: readonly unknown[]): Promise<void> {
  await writeFile(filePath, '', { mode: 0o600 });
  if (rows.length === 0) return;
  const contents = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
  await appendFile(filePath, contents, { mode: 0o600 });
}

function sum(
  results: CandidateMatchResult[],
  selectValue: (result: CandidateMatchResult) => number | undefined,
): number {
  return results.reduce((total, result) => total + (selectValue(result) ?? 0), 0);
}

function summarize(values: number[]): RunManifest['latency'] {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0, mean: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    mean: values.reduce((sumValue, value) => sumValue + value, 0) / values.length,
  };
}

function percentile(sorted: number[], fraction: number): number {
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? 0;
}
