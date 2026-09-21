import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CandidateMatchResult } from '../domain/types.js';
import { mae, pearsonCorrelation, rmse, spearmanCorrelation } from '../metrics/core.js';
import type { BatchRunResult } from '../pipeline/batch-runner.js';
import { writeJsonReport } from '../reports/json.js';
import { formatMetric, markdownTable, writeMarkdownReport } from '../reports/markdown.js';

export interface ContinuousMetrics {
  count: number;
  mae: number | null;
  rmse: number | null;
  pearson: number | null;
  spearman: number | null;
}

export function continuousMetrics(
  actual: readonly number[],
  predicted: readonly number[],
): ContinuousMetrics {
  return {
    count: actual.length,
    mae: mae(actual, predicted),
    rmse: rmse(actual, predicted),
    pearson: pearsonCorrelation(actual, predicted),
    spearman: spearmanCorrelation(actual, predicted),
  };
}

export function resultDimensionScore(
  result: CandidateMatchResult,
  dimension: 'requiredSkills' | 'relevantExperience' | 'seniority' | 'domainMatch',
): number {
  return result.dimensions[dimension].normalizedScore * 100;
}

export async function writeBenchmarkReport(input: {
  outputRoot: string;
  title: string;
  run: BatchRunResult;
  datasetDescription: string;
  metrics: Record<string, unknown>;
  extraSections?: ReadonlyArray<{ heading: string; content: string }>;
  knownLimitations: string[];
}): Promise<{ jsonPath: string; markdownPath: string }> {
  const { run } = input;
  const reportDir = path.join(input.outputRoot, 'reports', run.runId);
  await mkdir(reportDir, { recursive: true, mode: 0o700 });
  const manifest = run.manifest;
  const throughput =
    manifest.elapsedMs > 0 ? (manifest.successfulCount * 60_000) / manifest.elapsedMs : 0;
  const cacheHitRate =
    manifest.candidateCount > 0 ? manifest.cachedCount / manifest.candidateCount : 0;
  const successRate =
    manifest.candidateCount > 0 ? manifest.successfulCount / manifest.candidateCount : 0;
  const report = {
    title: input.title,
    runConfiguration: {
      runId: manifest.runId,
      model: manifest.model,
      rubricVersion: manifest.rubricVersion,
      scoringConfigVersion: manifest.scoringConfigVersion,
      dataset: manifest.dataset,
      datasetVersionOrHash: manifest.datasetVersionOrHash,
      jobId: manifest.jobId,
      concurrency: manifest.concurrency,
      startedAt: manifest.startedAt,
      completedAt: manifest.completedAt,
    },
    dataset: input.datasetDescription,
    counts: {
      candidatesOrPairs: manifest.candidateCount,
      successful: manifest.successfulCount,
      failed: manifest.failedCount,
      cached: manifest.cachedCount,
      liveRequests: manifest.liveRequestCount,
      retries: manifest.retryCount,
      rateLimits: manifest.rateLimitCount,
      successRate,
      cacheHitRate,
    },
    qualityMetrics: input.metrics,
    runtime: {
      elapsedMs: manifest.elapsedMs,
      throughputCandidatesPerMinute: throughput,
      latency: manifest.latency,
      inputTokens: manifest.totalInputTokens,
      outputTokens: manifest.totalOutputTokens,
      providerReportedCostUsd: manifest.providerReportedCostUsd,
    },
    failures: run.failures.map(({ candidateId, jobId, errorType, retryable, attempts }) => ({
      candidateId,
      jobId,
      errorType,
      retryable,
      attempts,
    })),
    knownLimitations: input.knownLimitations,
  };
  const jsonPath = await writeJsonReport(reportDir, report);
  const countRows = [
    ['Pairs/candidates', String(manifest.candidateCount)],
    ['Successful', String(manifest.successfulCount)],
    ['Failed', String(manifest.failedCount)],
    ['Cached', String(manifest.cachedCount)],
    ['Live requests', String(manifest.liveRequestCount)],
    ['Retries', String(manifest.retryCount)],
    ['Rate limits', String(manifest.rateLimitCount)],
    ['Elapsed time (ms)', String(manifest.elapsedMs)],
    ['Throughput (candidates/min)', formatMetric(throughput, 2)],
    ['Input tokens', String(manifest.totalInputTokens)],
    ['Output tokens', String(manifest.totalOutputTokens)],
    ['Provider reported cost (USD)', formatMetric(manifest.providerReportedCostUsd, 6)],
    [
      'Latency p50 / p95 / p99 (ms)',
      `${manifest.latency.p50} / ${manifest.latency.p95} / ${manifest.latency.p99}`,
    ],
  ];
  const sections = [
    {
      heading: 'Run configuration',
      content: markdownTable(
        ['Field', 'Value'],
        [
          ['Run ID', manifest.runId],
          ['Model', manifest.model],
          ['Rubric version', manifest.rubricVersion],
          ['Scoring configuration', manifest.scoringConfigVersion],
          ['Dataset', input.datasetDescription],
          ['Dataset hash', manifest.datasetVersionOrHash],
          ['Job ID', manifest.jobId ?? 'multiple / not applicable'],
        ],
      ),
    },
    { heading: 'Run counts and runtime', content: markdownTable(['Measure', 'Value'], countRows) },
    {
      heading: 'Quality metrics',
      content: `\`\`\`json\n${JSON.stringify(input.metrics, null, 2)}\n\`\`\``,
    },
    ...(input.extraSections ?? []),
    {
      heading: 'Failures',
      content:
        run.failures.length === 0
          ? 'No pair failures.'
          : markdownTable(
              ['Candidate ID', 'Job ID', 'Type', 'Retryable', 'Attempts'],
              run.failures.map((failure) => [
                failure.candidateId,
                failure.jobId,
                failure.errorType,
                String(failure.retryable),
                String(failure.attempts),
              ]),
            ),
    },
    {
      heading: 'Known limitations',
      content: input.knownLimitations.map((item) => `- ${item}`).join('\n'),
    },
  ];
  const markdownPath = await writeMarkdownReport(reportDir, { title: input.title, sections });
  await writeFile(
    path.join(run.runDir, 'report-paths.json'),
    JSON.stringify({ jsonPath, markdownPath }, null, 2),
    { mode: 0o600 },
  );
  return { jsonPath, markdownPath };
}

export function confidenceAndDisagreements(
  results: readonly CandidateMatchResult[],
  labelsByPair: ReadonlyMap<string, number>,
): { lowestConfidence: unknown[]; largestDisagreements: unknown[] } {
  const joined = results.flatMap((result) => {
    const label = labelsByPair.get(pairKey(result.jobId, result.candidateId));
    if (label === undefined) return [];
    return [{ result, label, disagreement: Math.abs(result.compositeScore - label) }];
  });
  const lowestConfidence = [...joined]
    .filter(({ result }) => result.aggregateConfidence !== undefined)
    .sort((left, right) => left.result.aggregateConfidence! - right.result.aggregateConfidence!)
    .slice(0, 10)
    .map(({ result }) => ({
      candidateId: result.candidateId,
      jobId: result.jobId,
      compositeScore: result.compositeScore,
      confidence: result.aggregateConfidence,
    }));
  const largestDisagreements = [...joined]
    .sort((left, right) => right.disagreement - left.disagreement)
    .slice(0, 10)
    .map(({ result, label, disagreement }) => ({
      candidateId: result.candidateId,
      jobId: result.jobId,
      layaScore: result.compositeScore,
      labelScore: label,
      absoluteDifference: disagreement,
    }));
  return { lowestConfidence, largestDisagreements };
}

export function pairKey(jobId: string, candidateId: string): string {
  return `${jobId}\u0000${candidateId}`;
}
