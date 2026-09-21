import type { CandidateMatchResult, DimensionScore } from '../domain/types.js';
import { COMPOSITE_WEIGHTS } from './rubric.js';

const SCORE_MAX = 4;
const EPSILON = 1e-9;

export function normalizeScore(rawScore: number): number {
  if (!Number.isFinite(rawScore) || rawScore < 0 || rawScore > SCORE_MAX) {
    throw new RangeError(`Score must be finite and between 0 and ${SCORE_MAX}`);
  }

  return rawScore / SCORE_MAX;
}

export function normalizeProbability(probability: number): number {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new RangeError('Probability must be finite and between 0 and 1');
  }

  return probability;
}

export function calculateCompositeScore(input: {
  requiredSkills: number;
  relevantExperience: number;
  seniority: number;
  domainMatch: number;
  mustHavesProbability: number;
}): number {
  const normalized = {
    requiredSkills: normalizeScore(input.requiredSkills),
    relevantExperience: normalizeScore(input.relevantExperience),
    seniority: normalizeScore(input.seniority),
    domainMatch: normalizeScore(input.domainMatch),
    mustHaves: normalizeProbability(input.mustHavesProbability),
  };

  const composite =
    normalized.requiredSkills * COMPOSITE_WEIGHTS.requiredSkills +
    normalized.relevantExperience * COMPOSITE_WEIGHTS.relevantExperience +
    normalized.seniority * COMPOSITE_WEIGHTS.seniority +
    normalized.domainMatch * COMPOSITE_WEIGHTS.domainMatch +
    normalized.mustHaves * COMPOSITE_WEIGHTS.mustHaves;

  return Math.round(composite * 100 * 1e8) / 1e8;
}

export function aggregateConfidence(
  dimensions: Partial<
    Record<
      'requiredSkills' | 'relevantExperience' | 'seniority' | 'domainMatch' | 'mustHaves',
      number | undefined
    >
  >,
): number | undefined {
  const weighted = Object.entries(COMPOSITE_WEIGHTS).flatMap(([key, weight]) => {
    const confidence = dimensions[key as keyof typeof dimensions];
    if (confidence === undefined) return [];
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new RangeError(`Confidence for ${key} must be between 0 and 1`);
    }
    return [{ confidence, weight }];
  });

  if (weighted.length === 0) return undefined;

  const totalWeight = weighted.reduce((sum, part) => sum + part.weight, 0);
  const mean = weighted.reduce((sum, part) => sum + part.confidence * part.weight, 0) / totalWeight;
  return Math.round(mean * 1e8) / 1e8;
}

export function dimensionFromRaw(
  rawScore: number,
  probabilities?: Record<string, number>,
  confidence?: number,
): DimensionScore {
  const score: DimensionScore = {
    rawScore,
    normalizedScore: normalizeScore(rawScore),
  };

  if (probabilities !== undefined) score.probabilities = probabilities;
  if (confidence !== undefined) score.confidence = normalizeProbability(confidence);
  return score;
}

export function assertScoreResultInvariant(result: CandidateMatchResult): void {
  const { dimensions } = result;
  const expected = calculateCompositeScore({
    requiredSkills: dimensions.requiredSkills.rawScore,
    relevantExperience: dimensions.relevantExperience.rawScore,
    seniority: dimensions.seniority.rawScore,
    domainMatch: dimensions.domainMatch.rawScore,
    mustHavesProbability: dimensions.mustHaves.probability,
  });

  if (Math.abs(expected - result.compositeScore) > EPSILON) {
    throw new Error(
      `Composite score mismatch: expected ${expected}, received ${result.compositeScore}`,
    );
  }
}
