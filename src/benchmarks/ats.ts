import { bm25Score } from '../baseline/bm25.js';
import type { AtsValidationRow } from '../datasets/types.js';
import type { CandidateMatchResult, ScoringInput } from '../domain/types.js';
import {
  classificationMetrics,
  mae,
  pearsonCorrelation,
  rmse,
  spearmanCorrelation,
} from '../metrics/core.js';
import { pairKey } from './common.js';
import { classifyAtsScore } from './labels.js';

export function atsRowsToInputs(rows: readonly AtsValidationRow[]): ScoringInput[] {
  return rows.map((row) => ({
    job: { id: `ats-job-${row.sourceRow}`, description: row.jobDescription },
    candidate: { id: row.id, resumeText: row.resumeText, source: 'ats-score' },
  }));
}

export function computeAtsMetrics(
  rows: readonly AtsValidationRow[],
  results: readonly CandidateMatchResult[],
): Record<string, unknown> {
  const resultMap = new Map(
    results.map((result) => [pairKey(result.jobId, result.candidateId), result]),
  );
  const matched = rows.flatMap((row) => {
    const result = resultMap.get(pairKey(`ats-job-${row.sourceRow}`, row.id));
    if (!result) return [];
    return [{ row, result }];
  });
  const actualScores = matched.map(({ row }) => row.atsScore);
  const layaScores = matched.map(({ result }) => result.compositeScore);
  const bm25Scores = matched.map(({ row }) => bm25Score(row.jobDescription, row.resumeText));
  const actualClasses = matched.map(({ row }) => classifyAtsScore(row.atsScore));
  const layaClasses = matched.map(({ result }) => classifyAtsScore(result.compositeScore));
  return {
    matchedPairCount: matched.length,
    laya: {
      meanAbsoluteError: mae(actualScores, layaScores),
      rootMeanSquaredError: rmse(actualScores, layaScores),
      pearson: pearsonCorrelation(actualScores, layaScores),
      spearman: spearmanCorrelation(actualScores, layaScores),
      classification: classificationMetrics(actualClasses, layaClasses, {
        labels: ['No Fit', 'Potential Fit', 'Good Fit'],
      }),
    },
    baseline: {
      bm25SpearmanWithAtsScore: spearmanCorrelation(actualScores, bm25Scores),
      bm25ScoreRange: bm25Scores.length
        ? { min: Math.min(...bm25Scores), max: Math.max(...bm25Scores) }
        : null,
    },
    classificationThresholds: {
      noFit: '< 40',
      potentialFit: '40 through 70 inclusive',
      goodFit: '> 70',
    },
  };
}
