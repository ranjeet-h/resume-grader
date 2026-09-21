import { rankByBm25 } from '../baseline/bm25.js';
import { stratifiedSample } from '../datasets/shared.js';
import type { BenchmarkLabel, RoleRadarData, RoleRadarPair } from '../datasets/types.js';
import type { CandidateMatchResult, JobInput, ScoringInput } from '../domain/types.js';
import {
  ndcgAtK,
  pairwiseOrderingAccuracy,
  precisionAtK,
  stableSortByScore,
} from '../metrics/core.js';
import { continuousMetrics, pairKey, resultDimensionScore } from './common.js';

export interface JoinedRoleRadarPair {
  pairId: string;
  input: ScoringInput;
  label: BenchmarkLabel;
  roleFamily: string;
  seniority: string;
}

export function selectDefaultBenchmarkJob(data: RoleRadarData): {
  jobId: string;
  labelCount: number;
} {
  const counts = new Map<string, number>();
  for (const pair of data.phase3Labels) counts.set(pair.jobId, (counts.get(pair.jobId) ?? 0) + 1);
  const top = [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )[0];
  if (!top) throw new Error('No phase3 labels could be resolved to known jobs and candidates');
  return { jobId: top[0], labelCount: top[1] };
}

export function joinRoleRadarLabels(
  data: RoleRadarData,
  rows: readonly RoleRadarPair[],
): { pairs: JoinedRoleRadarPair[]; unresolvedCount: number } {
  const jobs = new Map(data.jobs.map((job) => [job.id, job]));
  const candidates = new Map(data.candidates.map((candidate) => [candidate.id, candidate]));
  const pairs: JoinedRoleRadarPair[] = [];
  let unresolvedCount = 0;
  for (const row of rows) {
    const job = jobs.get(row.jobId);
    const candidate = candidates.get(row.candidateId);
    if (!job || !candidate || !row.label) {
      unresolvedCount += 1;
      continue;
    }
    const metadata = candidate.metadata ?? {};
    const roleFamily =
      row.roleFamily ?? job.roleFamily ?? stringMetadata(metadata, 'roleFamily') ?? 'unknown';
    const seniority = row.seniority ?? candidateSeniority(candidate) ?? job.seniority ?? 'unknown';
    pairs.push({
      pairId: row.pairId,
      input: { job, candidate },
      label: row.label,
      roleFamily,
      seniority,
    });
  }
  return { pairs, unresolvedCount };
}

export function sampleRoleRadarPairs(
  pairs: readonly JoinedRoleRadarPair[],
  limit: number,
  seed: number,
): JoinedRoleRadarPair[] {
  return stratifiedSample(pairs, limit, seed, (pair) => {
    const score = pair.label.composite ?? 0;
    const band = score < 60 ? 'low' : score < 80 ? 'middle' : 'high';
    return `${pair.roleFamily}|${pair.seniority}|${band}`;
  });
}

export function selectBestJob(data: RoleRadarData): JobInput {
  const selected = selectDefaultBenchmarkJob(data);
  const job = data.jobs.find((candidate) => candidate.id === selected.jobId);
  if (!job) throw new Error(`Selected job ${selected.jobId} is missing from the loaded job list`);
  return job;
}

export function computeRoleRadarMetrics(
  results: readonly CandidateMatchResult[],
  pairs: readonly JoinedRoleRadarPair[],
): Record<string, unknown> {
  const resultMap = new Map(
    results.map((result) => [pairKey(result.jobId, result.candidateId), result]),
  );
  const matched = pairs.flatMap((pair) => {
    const result = resultMap.get(pairKey(pair.input.job.id, pair.input.candidate.id));
    return result ? [{ pair, result }] : [];
  });
  const metrics: Record<string, unknown> = {
    matchedPairCount: matched.length,
    unmatchedScoredPairCount: Math.max(0, results.length - matched.length),
  };
  for (const dimension of ['skills', 'seniority', 'domain', 'composite'] as const) {
    const labeled = matched.flatMap(({ pair, result }) => {
      const actual = pair.label[dimension];
      if (actual === undefined) return [];
      const predicted =
        dimension === 'composite'
          ? result.compositeScore
          : resultDimensionScore(
              result,
              dimension === 'skills'
                ? 'requiredSkills'
                : dimension === 'seniority'
                  ? 'seniority'
                  : 'domainMatch',
            );
      return [{ actual, predicted }];
    });
    metrics[dimension] = continuousMetrics(
      labeled.map((row) => row.actual),
      labeled.map((row) => row.predicted),
    );
  }
  metrics['ranking'] = rankingMetrics(matched, (pair) => pair.result.compositeScore);
  return metrics;
}

function rankingMetrics(
  matched: Array<{ pair: JoinedRoleRadarPair; result: CandidateMatchResult }>,
  modelScore: (pair: { pair: JoinedRoleRadarPair; result: CandidateMatchResult }) => number,
): Record<string, unknown> {
  const groups = new Map<string, typeof matched>();
  for (const item of matched) {
    if (item.pair.label.composite === undefined) continue;
    const jobId = item.pair.input.job.id;
    const group = groups.get(jobId) ?? [];
    group.push(item);
    groups.set(jobId, group);
  }
  const layaRows: number[][] = [];
  const baselineRows: number[][] = [];
  const layaPairwise: Array<number | null> = [];
  const baselinePairwise: Array<number | null> = [];
  const layaOverlap: Array<number | null> = [];
  const baselineOverlap: Array<number | null> = [];
  for (const group of groups.values()) {
    // A single labeled candidate cannot measure ranking quality for a job.
    if (group.length < 2) continue;
    const job = group[0]!.pair.input.job;
    const bm25 = rankByBm25(
      job.description,
      group.map((entry) => ({
        id: entry.pair.input.candidate.id,
        text: entry.pair.input.candidate.resumeText,
      })),
    );
    const baselineById = new Map(bm25.map((entry) => [entry.id, entry.score]));
    const actual = group.map((entry) => entry.pair.label.composite ?? 0);
    const layaScores = group.map((entry) => modelScore(entry));
    const baselineScores = group.map(
      (entry) => baselineById.get(entry.pair.input.candidate.id) ?? 0,
    );
    layaRows.push(rankedRelevances(group, (entry) => modelScore(entry)));
    baselineRows.push(
      rankedRelevances(group, (entry) => baselineById.get(entry.pair.input.candidate.id) ?? 0),
    );
    layaPairwise.push(pairwiseOrderingAccuracy(actual, layaScores));
    baselinePairwise.push(pairwiseOrderingAccuracy(actual, baselineScores));
    layaOverlap.push(topKOverlap(group, (entry) => modelScore(entry), 10));
    baselineOverlap.push(
      topKOverlap(group, (entry) => baselineById.get(entry.pair.input.candidate.id) ?? 0, 10),
    );
  }
  const rankableJobCount = [...groups.values()].filter((group) => group.length > 1).length;
  return {
    jobCount: groups.size,
    rankableJobCount,
    singletonJobCount: groups.size - rankableJobCount,
    laya: averageRankingMetrics(layaRows, layaPairwise, layaOverlap),
    bm25: averageRankingMetrics(baselineRows, baselinePairwise, baselineOverlap),
  };
}

function rankedRelevances(
  group: Array<{ pair: JoinedRoleRadarPair; result: CandidateMatchResult }>,
  score: (entry: { pair: JoinedRoleRadarPair; result: CandidateMatchResult }) => number,
): number[] {
  const ranked = stableSortByScore(group, score);
  return ranked.map((entry) => entry.pair.label.composite ?? 0);
}

function averageRankingMetrics(
  rows: number[][],
  pairwise: Array<number | null>,
  overlap: Array<number | null>,
): Record<string, number | null> {
  return {
    ndcgAt5: average(rows.map((values) => ndcgAtK(values, 5))),
    ndcgAt10: average(rows.map((values) => ndcgAtK(values, 10))),
    ndcgAt20: average(rows.map((values) => ndcgAtK(values, 20))),
    precisionAt5: average(
      rows.filter((values) => values.length > 5).map((values) => precisionAtK(values, 5, 70)),
    ),
    precisionAt10: average(
      rows.filter((values) => values.length > 10).map((values) => precisionAtK(values, 10, 70)),
    ),
    topKOverlapAt10: average(overlap),
    pairwiseOrderingAccuracy: average(pairwise),
  };
}

function topKOverlap(
  group: Array<{ pair: JoinedRoleRadarPair; result: CandidateMatchResult }>,
  score: (entry: { pair: JoinedRoleRadarPair; result: CandidateMatchResult }) => number,
  k: number,
): number | null {
  if (group.length <= k) return null;
  const truth = stableSortByScore(group, (entry) => entry.pair.label.composite ?? 0).slice(0, k);
  const predicted = stableSortByScore(group, score).slice(0, k);
  const truthIds = new Set(truth.map((entry) => entry.pair.input.candidate.id));
  return (
    predicted.filter((entry) => truthIds.has(entry.pair.input.candidate.id)).length /
    Math.min(k, group.length)
  );
}

function average(values: readonly (number | null)[]): number | null {
  const valid = values.filter((value): value is number => value !== null);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function stringMetadata(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === 'string' ? value : undefined;
}

function candidateSeniority(candidate: ScoringInput['candidate']): string | undefined {
  const metadata = candidate.metadata;
  const seniority = metadata?.['seniority'];
  return typeof seniority === 'string' ? seniority : undefined;
}
