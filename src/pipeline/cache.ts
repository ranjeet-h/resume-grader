import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CacheRecord, CandidateMatchResult, ScoringInput } from '../domain/types.js';
import { normalizeJobDescription } from '../normalization/jd.js';
import { normalizeCandidate } from '../normalization/resume.js';
import { calculateCompositeScore } from '../scoring/composite.js';
import { RUBRIC_VERSION, SCORING_CONFIG_VERSION } from '../scoring/rubric.js';

export class EvaluationCache {
  constructor(
    private readonly rootDir: string,
    private readonly model: string,
  ) {}

  get modelId(): string {
    return this.model;
  }

  getKey(input: ScoringInput): string {
    const job = normalizeJobDescription(input.job);
    const candidate = normalizeCandidate(input.candidate);
    return createHash('sha256')
      .update(
        JSON.stringify({
          model: this.model,
          rubricVersion: RUBRIC_VERSION,
          job: {
            title: job.title ?? '',
            description: job.description,
            seniority: job.seniority ?? '',
          },
          resumeText: candidate.resumeText,
        }),
      )
      .digest('hex');
  }

  async get(input: ScoringInput): Promise<CandidateMatchResult | undefined> {
    const key = this.getKey(input);
    const filePath = this.pathForKey(key);
    let record: CacheRecord;
    try {
      record = JSON.parse(await readFile(filePath, 'utf8')) as CacheRecord;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      if (error instanceof SyntaxError) return undefined;
      throw error;
    }
    if (record.cacheVersion !== 1 || record.key !== key || record.model !== this.model)
      return undefined;
    const result: CandidateMatchResult = {
      ...record.result,
      candidateId: input.candidate.id,
      jobId: input.job.id,
      cached: true,
      scoringConfigVersion: SCORING_CONFIG_VERSION,
      compositeScore: calculateCompositeScore({
        requiredSkills: record.result.dimensions.requiredSkills.rawScore,
        relevantExperience: record.result.dimensions.relevantExperience.rawScore,
        seniority: record.result.dimensions.seniority.rawScore,
        domainMatch: record.result.dimensions.domainMatch.rawScore,
        mustHavesProbability: record.result.dimensions.mustHaves.probability,
      }),
    };
    return result;
  }

  async set(input: ScoringInput, result: CandidateMatchResult): Promise<void> {
    const key = this.getKey(input);
    const filePath = this.pathForKey(key);
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const record: CacheRecord = {
      cacheVersion: 1,
      key,
      model: this.model,
      rubricVersion: RUBRIC_VERSION,
      result,
    };
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(record), { mode: 0o600 });
    const { rename } = await import('node:fs/promises');
    await rename(temporaryPath, filePath);
  }

  private pathForKey(key: string): string {
    return path.join(this.rootDir, key.slice(0, 2), `${key}.json`);
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
