import type { CandidateMatchResult, JobInput, ScoringInput } from '../domain/types.js';
import { normalizeJobDescription } from '../normalization/jd.js';
import { normalizeCandidate } from '../normalization/resume.js';
import {
  aggregateConfidence,
  calculateCompositeScore,
  dimensionFromRaw,
  normalizeProbability,
  normalizeScore,
} from '../scoring/composite.js';
import { RUBRIC_VERSION, SCORING_CONFIG_VERSION } from '../scoring/rubric.js';
import { ModelResponseParseError } from './errors.js';

export interface ScoringProvider {
  evaluate(input: ScoringInput): Promise<CandidateMatchResult>;
  close?(): Promise<void>;
}

export type CandidateEvaluator = ScoringProvider;

export interface ModelEvaluationResponse {
  id?: string;
  model: string;
  answers: Record<string, unknown>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cost: number;
  };
}

export function prepareModelInput(
  jobInput: JobInput,
  candidateInput: ScoringInput['candidate'],
): ScoringInput {
  const job = normalizeJobDescription(jobInput);
  const candidate = normalizeCandidate(candidateInput);
  return {
    job: {
      id: job.id,
      title: job.title,
      description: job.description,
      seniority: job.seniority,
    },
    candidate: {
      id: candidate.id,
      resumeText: candidate.resumeText,
      source: candidate.source,
    },
  };
}

export function mapTypedAnswersToResult(
  response: ModelEvaluationResponse,
  input: ScoringInput,
  latencyMs: number,
): CandidateMatchResult {
  const answers = response.answers;
  const requiredSkills = mapScoreAnswer(answers.requiredSkills);
  const relevantExperience = mapScoreAnswer(answers.relevantExperience);
  const seniority = mapScoreAnswer(answers.seniority);
  const domainMatch = mapScoreAnswer(answers.domainMatch);
  const mustHaveProbability = mapNoulAnswer(answers.mustHaves);
  const compositeScore = calculateCompositeScore({
    requiredSkills: requiredSkills.rawScore,
    relevantExperience: relevantExperience.rawScore,
    seniority: seniority.rawScore,
    domainMatch: domainMatch.rawScore,
    mustHavesProbability: mustHaveProbability,
  });
  const aggregate = aggregateConfidence({
    requiredSkills: requiredSkills.confidence,
    relevantExperience: relevantExperience.confidence,
    seniority: seniority.confidence,
    domainMatch: domainMatch.confidence,
  });
  const usage: NonNullable<CandidateMatchResult['usage']> = {
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    totalTokens: response.usage.inputTokens + response.usage.outputTokens,
    costUsd: response.usage.cost,
  };

  const mapped: CandidateMatchResult = {
    candidateId: input.candidate.id,
    jobId: input.job.id,
    rubricVersion: RUBRIC_VERSION,
    scoringConfigVersion: SCORING_CONFIG_VERSION,
    model: response.model,
    compositeScore,
    dimensions: {
      requiredSkills,
      relevantExperience,
      seniority,
      domainMatch,
      mustHaves: { probability: mustHaveProbability },
    },
    rawAnswers: response.answers,
    usage,
    latencyMs,
    cached: false,
    createdAt: new Date().toISOString(),
  };
  if (aggregate !== undefined) mapped.aggregateConfidence = aggregate;
  const responseMetadata: NonNullable<CandidateMatchResult['responseMetadata']> = {};
  if (response.id) responseMetadata.id = response.id;
  responseMetadata.modelId = response.model;
  responseMetadata.timestamp = mapped.createdAt;
  mapped.responseMetadata = responseMetadata;
  return mapped;
}

function mapScoreAnswer(value: unknown) {
  const answer = readObject(value);
  if (answer?.['type'] !== 'score' || typeof answer['score'] !== 'number') {
    throw new ModelResponseParseError('Model response is missing a typed score answer');
  }
  try {
    const normalizedScore = normalizeScore(answer.score);
    const probabilities = isProbabilityMap(answer['probabilities'])
      ? answer['probabilities']
      : undefined;
    const confidence = isProbability(answer['confidence']) ? answer['confidence'] : undefined;
    const dimension = dimensionFromRaw(answer.score, probabilities, confidence);
    dimension.normalizedScore = normalizedScore;
    return dimension;
  } catch (error) {
    throw new ModelResponseParseError('Model returned a score outside the five-level 0..4 rubric', {
      cause: error,
    });
  }
}

function mapNoulAnswer(value: unknown): number {
  const answer = readObject(value);
  if (answer?.['type'] !== 'noul' || typeof answer['noul'] !== 'number') {
    throw new ModelResponseParseError('Model response is missing a typed must-have probability');
  }
  try {
    return normalizeProbability(answer.noul);
  } catch (error) {
    throw new ModelResponseParseError('Model returned a must-have probability outside 0..1', {
      cause: error,
    });
  }
}

function isProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isProbabilityMap(value: unknown): value is Record<string, number> {
  const object = readObject(value);
  return object !== undefined && Object.values(object).every(isProbability);
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
