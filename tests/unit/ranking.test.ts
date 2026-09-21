import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CandidateMatchResult } from '../../src/domain/types.js';
import { writeRankingFiles } from '../../src/reports/ranking.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('ranking export', () => {
  it('writes a CSV ranking without resume text and applies private Unix permissions', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'resume-matcher-ranking-'));
    temporaryDirectories.push(root);
    const result: CandidateMatchResult = {
      candidateId: 'candidate-0001',
      jobId: 'job-1',
      rubricVersion: 'resume-match-v2',
      scoringConfigVersion: 'resume-match-weights-v1',
      model: 'local-model',
      dimensions: {
        requiredSkills: { rawScore: 4, normalizedScore: 1 },
        relevantExperience: { rawScore: 3, normalizedScore: 0.75 },
        seniority: { rawScore: 2, normalizedScore: 0.5 },
        domainMatch: { rawScore: 3, normalizedScore: 0.75 },
        mustHaves: { probability: 0.8 },
      },
      compositeScore: 81,
      latencyMs: 12,
      cached: false,
      createdAt: '2026-09-21T00:00:00.000Z',
    };

    const files = await writeRankingFiles(root, 'run-1', [result]);
    const csv = await readFile(files.csvPath, 'utf8');
    expect(csv).toContain('"rank","candidateId","compositeScore"');
    expect(csv).toContain('"1","candidate-0001","81"');
    expect(csv).not.toContain('resumeText');
    if (process.platform !== 'win32') {
      expect((await stat(files.directory)).mode & 0o777).toBe(0o700);
      expect((await stat(files.csvPath)).mode & 0o777).toBe(0o600);
    }
  });
});
