import { z } from 'zod';

export const candidateSourceSchema = z.enum(['role-radar', 'ats-score', 'kaggle', 'custom']);

export const jobInputSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  description: z.string().min(1),
  location: z.string().optional(),
  seniority: z.string().optional(),
  roleFamily: z.string().optional(),
});

export const candidateInputSchema = z.object({
  id: z.string().min(1),
  resumeText: z.string(),
  source: candidateSourceSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type JobInput = z.infer<typeof jobInputSchema>;
export type CandidateInput = z.infer<typeof candidateInputSchema>;
export type CandidateSource = z.infer<typeof candidateSourceSchema>;

export interface DimensionScore {
  rawScore: number;
  normalizedScore: number;
  probabilities?: Record<string, number>;
  confidence?: number;
}

export interface CandidateMatchResult {
  candidateId: string;
  jobId: string;
  rubricVersion: string;
  scoringConfigVersion: string;
  model: string;
  dimensions: {
    requiredSkills: DimensionScore;
    relevantExperience: DimensionScore;
    seniority: DimensionScore;
    domainMatch: DimensionScore;
    mustHaves: {
      probability: number;
      confidence?: number;
    };
  };
  compositeScore: number;
  aggregateConfidence?: number;
  rawAnswers?: Record<string, unknown>;
  providerMetadata?: Record<string, unknown>;
  responseMetadata?: {
    id?: string;
    modelId?: string;
    timestamp?: string;
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    costUsd?: number;
  };
  latencyMs: number;
  cached: boolean;
  createdAt: string;
}

export type PairFailureType =
  | 'validation'
  | 'authentication'
  | 'rate_limit'
  | 'timeout'
  | 'provider'
  | 'parse'
  | 'skipped'
  | 'unknown';

export interface PairFailure {
  candidateId: string;
  jobId: string;
  errorType: PairFailureType;
  retryable: boolean;
  attempts: number;
  message: string;
}

export interface CacheRecord {
  cacheVersion: 1;
  key: string;
  model: string;
  rubricVersion: string;
  result: CandidateMatchResult;
}

export interface ScoringInput {
  job: JobInput;
  candidate: CandidateInput;
}
