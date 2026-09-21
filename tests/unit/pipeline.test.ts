import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CandidateMatchResult, ScoringInput } from '../../src/domain/types.js';
import { runBatch } from '../../src/pipeline/batch-runner.js';
import { EvaluationCache } from '../../src/pipeline/cache.js';
import { calculateBackoffDelay, withRetry } from '../../src/providers/retry.js';
import { DEFAULT_MODEL_ID } from '../../src/scoring/rubric.js';

const input: ScoringInput = {
  job: { id: 'job-1', description: 'Build TypeScript services.' },
  candidate: { id: 'candidate-1', source: 'custom', resumeText: 'TypeScript backend engineer.' },
};

function result(pair: ScoringInput): CandidateMatchResult {
  return {
    candidateId: pair.candidate.id,
    jobId: pair.job.id,
    rubricVersion: 'resume-match-v1',
    scoringConfigVersion: 'resume-match-weights-v1',
    model: DEFAULT_MODEL_ID,
    dimensions: {
      requiredSkills: { rawScore: 3, normalizedScore: 0.75 },
      relevantExperience: { rawScore: 3, normalizedScore: 0.75 },
      seniority: { rawScore: 3, normalizedScore: 0.75 },
      domainMatch: { rawScore: 3, normalizedScore: 0.75 },
      mustHaves: { probability: 0.8 },
    },
    compositeScore: 76.25,
    usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110, costUsd: 0.00001 },
    latencyMs: 7,
    cached: false,
    createdAt: '2026-09-19T00:00:00.000Z',
  };
}

describe('cache and batch runner', () => {
  it('uses a content hash cache and restores the request-specific IDs', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'laya-cache-'));
    try {
      const cache = new EvaluationCache(directory, DEFAULT_MODEL_ID);
      await cache.set(input, result(input));
      const cached = await cache.get({
        job: input.job,
        candidate: { ...input.candidate, id: 'candidate-2' },
      });
      expect(cached?.cached).toBe(true);
      expect(cached?.candidateId).toBe('candidate-2');
      expect(cached?.usage?.costUsd).toBe(0.00001);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('runs through an injected evaluator and records provider usage without network access', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'laya-batch-'));
    try {
      let calls = 0;
      const pair = { job: input.job, candidate: input.candidate };
      const run = await runBatch({
        dataset: 'unit',
        datasetVersionOrHash: 'fixture-hash',
        pairs: [pair],
        evaluator: {
          evaluate: async (value) => {
            calls += 1;
            return result(value);
          },
        },
        outputRoot: directory,
        concurrency: 1,
        maxRetries: 0,
      });
      expect(calls).toBe(1);
      expect(run.manifest.liveRequestCount).toBe(1);
      expect(run.manifest.totalInputTokens).toBe(100);
      expect(run.manifest.totalOutputTokens).toBe(10);
      expect(run.manifest.providerReportedCostUsd).toBe(0.00001);
      const resultsFile = await readFile(path.join(run.runDir, 'results.jsonl'), 'utf8');
      expect(JSON.parse(resultsFile).usage.costUsd).toBe(0.00001);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('stops scheduling new requests after a local-model rate limit', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'laya-stop-'));
    try {
      let calls = 0;
      const pairs = Array.from({ length: 3 }, (_, index) => ({
        job: input.job,
        candidate: { ...input.candidate, id: `candidate-${index}` },
      }));
      const run = await runBatch({
        dataset: 'unit-model-stop',
        datasetVersionOrHash: 'fixture-hash',
        pairs,
        evaluator: {
          evaluate: async () => {
            calls += 1;
            throw Object.assign(new Error('Local Laya evaluation failed'), {
              statusCode: 429,
            });
          },
        },
        outputRoot: directory,
        concurrency: 1,
        maxRetries: 0,
        stopOnFailure: true,
      });
      expect(calls).toBe(1);
      expect(run.failures.map((failure) => failure.errorType)).toEqual([
        'rate_limit',
        'skipped',
        'skipped',
      ]);
      expect(run.manifest.liveRequestCount).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('retry behavior', () => {
  it('retries rate limits with bounded exponential backoff and jitter', async () => {
    expect(calculateBackoffDelay(0, () => 0.5)).toBe(500);
    expect(calculateBackoffDelay(4, () => 0.5)).toBe(8000);
    let calls = 0;
    const delays: number[] = [];
    const value = await withRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error('rate limited'), { status: 429 });
        return 'ok';
      },
      {
        maxRetries: 2,
        random: () => 0.5,
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
      },
    );
    expect(value).toBe('ok');
    expect(calls).toBe(2);
    expect(delays).toEqual([500]);
  });
});
