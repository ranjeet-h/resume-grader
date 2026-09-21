import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CandidateMatchResult } from '../domain/types.js';
import { stableSortByScore } from '../metrics/core.js';
import { markdownTable } from './markdown.js';

export interface RankedMatch {
  rank: number;
  candidateId: string;
  compositeScore: number;
  requiredSkillsScore: number;
  relevantExperienceScore: number;
  seniorityScore: number;
  domainScore: number;
  mustHaveProbability: number;
  confidence?: number;
  latencyMs: number;
  cached: boolean;
}

export function toRankedMatches(results: readonly CandidateMatchResult[]): RankedMatch[] {
  const sorted = stableSortByScore(results, (result) => result.compositeScore);
  return sorted.map((result, index) => {
    const ranked: RankedMatch = {
      rank: index + 1,
      candidateId: result.candidateId,
      compositeScore: result.compositeScore,
      requiredSkillsScore: result.dimensions.requiredSkills.normalizedScore * 100,
      relevantExperienceScore: result.dimensions.relevantExperience.normalizedScore * 100,
      seniorityScore: result.dimensions.seniority.normalizedScore * 100,
      domainScore: result.dimensions.domainMatch.normalizedScore * 100,
      mustHaveProbability: result.dimensions.mustHaves.probability,
      latencyMs: result.latencyMs,
      cached: result.cached,
    };
    if (result.aggregateConfidence !== undefined) ranked.confidence = result.aggregateConfidence;
    return ranked;
  });
}

export async function writeRankingFiles(
  outputRoot: string,
  runId: string,
  results: readonly CandidateMatchResult[],
): Promise<{
  directory: string;
  allPath: string;
  top20Path: string;
  top50Path: string;
  csvPath: string;
  markdownPath: string;
}> {
  const directory = path.join(outputRoot, 'rankings', runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const all = toRankedMatches(results);
  const allPath = path.join(directory, 'all.json');
  const top20Path = path.join(directory, 'top-20.json');
  const top50Path = path.join(directory, 'top-50.json');
  const csvPath = path.join(directory, 'all.csv');
  const markdownPath = path.join(directory, 'top-20.md');
  await writeFile(allPath, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
  await writeFile(top20Path, `${JSON.stringify(all.slice(0, 20), null, 2)}\n`, { mode: 0o600 });
  await writeFile(top50Path, `${JSON.stringify(all.slice(0, 50), null, 2)}\n`, { mode: 0o600 });
  const csvColumns: Array<keyof RankedMatch> = [
    'rank',
    'candidateId',
    'compositeScore',
    'requiredSkillsScore',
    'relevantExperienceScore',
    'seniorityScore',
    'domainScore',
    'mustHaveProbability',
    'confidence',
    'latencyMs',
    'cached',
  ];
  const csvCell = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [
    csvColumns.map((column) => csvCell(column)).join(','),
    ...all.map((row) => csvColumns.map((column) => csvCell(row[column])).join(',')),
  ].join('\n');
  await writeFile(csvPath, `${csv}\n`, { mode: 0o600 });
  const topRows = all
    .slice(0, 20)
    .map((row) => [
      String(row.rank),
      row.candidateId,
      row.compositeScore.toFixed(2),
      row.requiredSkillsScore.toFixed(1),
      row.relevantExperienceScore.toFixed(1),
      row.seniorityScore.toFixed(1),
      row.domainScore.toFixed(1),
      row.mustHaveProbability.toFixed(3),
      row.confidence?.toFixed(3) ?? 'not available',
      String(row.latencyMs),
      row.cached ? 'yes' : 'no',
    ]);
  await writeFile(
    markdownPath,
    [
      '# Top 20 candidate matches',
      '',
      markdownTable(
        [
          'Rank',
          'Candidate ID',
          'Composite',
          'Skills',
          'Experience',
          'Seniority',
          'Domain',
          'Must-haves',
          'Confidence',
          'Latency ms',
          'Cached',
        ],
        topRows,
      ),
      '',
      'Candidate resumes and protected personal information are excluded from this export.',
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  return { directory, allPath, top20Path, top50Path, csvPath, markdownPath };
}
