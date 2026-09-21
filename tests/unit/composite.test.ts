import { describe, expect, it } from 'vitest';
import {
  aggregateConfidence,
  calculateCompositeScore,
  normalizeProbability,
  normalizeScore,
} from '../../src/scoring/composite.js';

describe('deterministic composite scoring', () => {
  it('normalizes scores and probabilities', () => {
    expect(normalizeScore(2)).toBe(0.5);
    expect(normalizeProbability(0.25)).toBe(0.25);
    expect(() => normalizeScore(5)).toThrow('between 0 and 4');
    expect(() => normalizeProbability(-0.1)).toThrow('between 0 and 1');
  });

  it('applies the documented weighted formula on a 0..100 scale', () => {
    expect(
      calculateCompositeScore({
        requiredSkills: 4,
        relevantExperience: 3,
        seniority: 2,
        domainMatch: 1,
        mustHavesProbability: 0.75,
      }),
    ).toBe(75);
  });

  it('aggregates only available confidence values using relative weights', () => {
    expect(aggregateConfidence({ requiredSkills: 0.9, relevantExperience: 0.8 })).toBeCloseTo(
      0.85333333,
    );
    expect(aggregateConfidence({})).toBeUndefined();
  });
});
