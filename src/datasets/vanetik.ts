import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { CandidateInput, JobInput, ScoringInput } from '../domain/types.js';

const rankSchema = z.array(z.number().int().min(1).max(5)).length(5);

const datasetSchema = z.object({
  source: z.string(),
  sourceUrl: z.string().url(),
  sourceLicense: z.string(),
  datasetVersionOrHash: z.string().length(64),
  annotationDirection: z.string(),
  jobs: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        description: z.string().min(1),
      }),
    )
    .length(5),
  candidates: z
    .array(z.object({ id: z.string().min(1), resumeText: z.string().min(100) }))
    .length(30),
  annotations: z
    .array(
      z.object({
        candidateId: z.string().min(1),
        annotator1: rankSchema,
        annotator2: rankSchema,
      }),
    )
    .length(30),
  nonStrictRankingRows: z.array(
    z.object({ annotator: z.enum(['annotator1', 'annotator2']), candidateId: z.string() }),
  ),
});

export type VanetikDataset = z.infer<typeof datasetSchema>;

export async function loadVanetikDataset(path: string): Promise<VanetikDataset> {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  return datasetSchema.parse(value);
}

export function toVanetikPairs(dataset: VanetikDataset): ScoringInput[] {
  return dataset.candidates.flatMap((candidate) =>
    dataset.jobs.map((job) => ({
      job: toJobInput(job),
      candidate: toCandidateInput(candidate),
    })),
  );
}

function toJobInput(job: VanetikDataset['jobs'][number]): JobInput {
  return {
    id: `vanetik-vacancy-${job.id}`,
    title: job.title,
    description: job.description,
    roleFamily: 'Software Developer',
  };
}

function toCandidateInput(candidate: VanetikDataset['candidates'][number]): CandidateInput {
  return {
    id: `vanetik-${candidate.id}`,
    resumeText: candidate.resumeText,
    source: 'custom',
    metadata: { sourceId: candidate.id },
  };
}
