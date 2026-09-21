import { describe, expect, it } from 'vitest';
import type { CandidateMatchResult } from '../../src/domain/types.js';
import {
  projectModelPreflight,
  REQUIRED_MODEL_PREFLIGHT_SIZE,
} from '../../src/providers/model-preflight.js';
import { DEFAULT_MODEL_ID } from '../../src/scoring/rubric.js';

function results(costUsd = 0): CandidateMatchResult[] {
  return Array.from({ length: REQUIRED_MODEL_PREFLIGHT_SIZE }, (_, index) => ({
    candidateId: `candidate-${index}`,
    jobId: 'job-1',
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
    usage: { inputTokens: 1000 + index, outputTokens: 20, totalTokens: 1020 + index, costUsd },
    latencyMs: 10,
    cached: false,
    createdAt: '2026-09-20T00:00:00.000Z',
  }));
}

describe('zero-cost provider preflight', () => {
  it('records ten actual token usages and projects zero cost for 500 candidates', () => {
    const projection = projectModelPreflight(results(), 500);
    expect(projection.sampleCount).toBe(10);
    expect(projection.observedInputTokens).toBe(10_045);
    expect(projection.observedOutputTokens).toBe(200);
    expect(projection.observedCostUsd).toBe(0);
    expect(projection.projectedFullCostUsd).toBe(0);
    expect(projection.projectedRemainingCostUsd).toBe(0);
  });

  it('fails closed on any nonzero cost', () => {
    expect(() => projectModelPreflight(results(0.001), 500)).toThrow('reports nonzero local cost');
  });

  it('requires exactly ten successful evaluations', () => {
    expect(() => projectModelPreflight(results().slice(0, 9), 500)).toThrow(
      'Expected 10 successful local-model evaluations',
    );
  });
});
