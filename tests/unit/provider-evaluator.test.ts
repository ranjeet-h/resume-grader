import { describe, expect, it } from 'vitest';
import type { ScoringInput } from '../../src/domain/types.js';
import {
  type ModelEvaluationResponse,
  mapTypedAnswersToResult,
  prepareModelInput,
} from '../../src/providers/evaluator.js';
import { DEFAULT_MODEL_ID } from '../../src/scoring/rubric.js';

const input: ScoringInput = {
  job: {
    id: 'job-1',
    title: 'Backend Engineer',
    description: 'TypeScript and PostgreSQL',
    seniority: 'Senior',
  },
  candidate: {
    id: 'candidate-1',
    source: 'custom',
    resumeText:
      'Jordan Example\njordan@example.com\n+1 415 555 0100\nBuilt TypeScript services with PostgreSQL.',
  },
};

function response(): ModelEvaluationResponse {
  return {
    id: 'local-1',
    model: DEFAULT_MODEL_ID,
    answers: {
      requiredSkills: {
        type: 'score',
        score: 4,
        probabilities: { '4': 0.8 },
        confidence: 0.9,
      },
      relevantExperience: { type: 'score', score: 3, confidence: 0.8 },
      seniority: { type: 'score', score: 2, confidence: 0.7 },
      domainMatch: { type: 'score', score: 1, confidence: 0.6 },
      mustHaves: { type: 'noul', noul: 0.75 },
    },
    usage: { inputTokens: 321, outputTokens: 0, cost: 0 },
  };
}

describe('model response mapping', () => {
  it('maps Laya typed answers, confidence, and local usage into a composite result', () => {
    const result = mapTypedAnswersToResult(
      response(),
      prepareModelInput(input.job, input.candidate),
      23,
    );

    expect(result.model).toBe(DEFAULT_MODEL_ID);
    expect(result.dimensions.requiredSkills.rawScore).toBe(4);
    expect(result.dimensions.requiredSkills.confidence).toBe(0.9);
    expect(result.dimensions.mustHaves.probability).toBe(0.75);
    expect(result.compositeScore).toBe(75);
    expect(result.usage).toEqual({
      inputTokens: 321,
      outputTokens: 0,
      totalTokens: 321,
      costUsd: 0,
    });
    expect(result.responseMetadata?.id).toBe('local-1');
  });

  it('redacts contact details before preparing input for a model provider', () => {
    const prepared = prepareModelInput(input.job, input.candidate);
    expect(prepared.candidate.resumeText).toContain('Built TypeScript services');
    expect(prepared.candidate.resumeText).not.toContain('Jordan Example');
    expect(prepared.candidate.resumeText).not.toContain('jordan@example.com');
    expect(prepared.candidate.resumeText).not.toContain('415 555 0100');
  });

  it('rejects missing typed score answers', () => {
    const broken = response();
    delete broken.answers['requiredSkills'];
    expect(() => mapTypedAnswersToResult(broken, input, 10)).toThrow(
      'missing a typed score answer',
    );
  });
});
