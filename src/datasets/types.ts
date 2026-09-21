import type { CandidateInput, JobInput } from '../domain/types.js';

export interface BenchmarkLabel {
  skills?: number;
  seniority?: number;
  domain?: number;
  location?: number;
  composite?: number;
  source?: string;
  reasoning?: string;
}

export interface RoleRadarPair {
  pairId: string;
  candidateId: string;
  jobId: string;
  label?: BenchmarkLabel;
  roleFamily?: string;
  seniority?: string;
}

export interface RoleRadarData {
  jobs: JobInput[];
  candidates: CandidateInput[];
  phase2Pairs: RoleRadarPair[];
  phase2Labels: RoleRadarPair[];
  phase3Pairs: RoleRadarPair[];
  phase3Labels: RoleRadarPair[];
  goldLabels: RoleRadarPair[];
  datasetVersionOrHash: string;
  sourceFiles: string[];
  issues: ParseIssue[];
}

export interface AtsValidationRow {
  id: string;
  resumeText: string;
  jobDescription: string;
  atsScore: number;
  originalLabel?: string;
  sourceRow: number;
}

export interface ParseIssue {
  sourceRow: number;
  reason: string;
}

export interface AtsDataset {
  rows: AtsValidationRow[];
  issues: ParseIssue[];
  datasetVersionOrHash: string;
  sourceFile: string;
}

export interface KaggleResumeRow {
  id: string;
  resumeText: string;
  category?: string;
  sourceRow: number;
}

export interface KaggleDataset {
  rows: KaggleResumeRow[];
  issues: ParseIssue[];
  csvPath: string;
  pdfRoot: string;
  datasetVersionOrHash: string;
}
