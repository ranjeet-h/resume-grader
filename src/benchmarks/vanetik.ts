import { rankByBm25 } from '../baseline/bm25.js';
import type { VanetikDataset } from '../datasets/vanetik.js';
import type { CandidateMatchResult } from '../domain/types.js';
import { ndcgAtK, spearmanCorrelation, stableSortByScore } from '../metrics/core.js';
import { markdownTable } from '../reports/markdown.js';

export interface VanetikRankingRow {
  vacancyId: string;
  vacancyTitle: string;
  vacancyRank: number;
  candidateId: string;
  compositeScore: number;
  skillsScore: number;
  experienceScore: number;
  seniorityScore: number;
  domainScore: number;
  mustHaveProbability: number;
  annotator1Rank: number;
  annotator2Rank: number;
  meanHumanRank: number;
}

export function computeVanetikMetrics(
  results: readonly CandidateMatchResult[],
  dataset: VanetikDataset,
): Record<string, unknown> {
  const resultMap = new Map(
    results.map((result) => [`${result.jobId}\0${result.candidateId}`, result]),
  );
  const candidateResults = dataset.candidates.map((candidate) =>
    dataset.jobs.map((job) => resultMap.get(`${toJobId(job.id)}\0${toCandidateId(candidate.id)}`)),
  );
  const layaScores = candidateResults.map((rows) =>
    rows.map((result) => result?.compositeScore ?? Number.NaN),
  );
  const bm25Scores = dataset.candidates.map((candidate) => {
    const ranked = rankByBm25(
      candidate.resumeText,
      dataset.jobs.map((job) => ({
        id: toJobId(job.id),
        text: `${job.title}\n${job.description}`,
      })),
    );
    const scoreByJob = new Map(ranked.map((item) => [item.id, item.score]));
    return dataset.jobs.map((job) => scoreByJob.get(toJobId(job.id)) ?? 0);
  });
  const completeCandidates = candidateResults.flatMap((rows, index) =>
    rows.every((result) => result !== undefined) ? [index] : [],
  );
  const annotationsByCandidate = new Map(
    dataset.annotations.map((annotation) => [annotation.candidateId, annotation]),
  );
  const annotator1 = evaluateAnnotator(
    layaScores,
    completeCandidates,
    annotationsByCandidate,
    'annotator1',
  );
  const annotator2 = evaluateAnnotator(
    layaScores,
    completeCandidates,
    annotationsByCandidate,
    'annotator2',
  );
  const consensus = evaluateConsensus(layaScores, completeCandidates, annotationsByCandidate);
  const bm25VsAnnotator1 = evaluateAnnotator(
    bm25Scores,
    completeCandidates,
    annotationsByCandidate,
    'annotator1',
  );
  const bm25VsAnnotator2 = evaluateAnnotator(
    bm25Scores,
    completeCandidates,
    annotationsByCandidate,
    'annotator2',
  );
  const bm25VsConsensus = evaluateConsensus(bm25Scores, completeCandidates, annotationsByCandidate);
  const interAnnotator = evaluateInterAnnotator(completeCandidates, annotationsByCandidate);
  const scoreValues = candidateResults.flatMap((rows) =>
    rows.flatMap((result) => (result ? [result.compositeScore] : [])),
  );

  return {
    scoredPairs: results.length,
    expectedPairs: dataset.jobs.length * dataset.candidates.length,
    completeResumesCompared: completeCandidates.length,
    vacancyCount: dataset.jobs.length,
    annotatorCount: 2,
    modelScoreScale: 'Laya rubric score 0-100; not a calibrated probability',
    layaCompositeScore: {
      count: scoreValues.length,
      mean: mean(scoreValues),
      min: scoreValues.length ? Math.min(...scoreValues) : null,
      max: scoreValues.length ? Math.max(...scoreValues) : null,
    },
    annotationQuality: {
      nonStrictRows: dataset.nonStrictRankingRows,
      interAnnotatorPairwiseAgreement: interAnnotator.agreement,
      interAnnotatorDecisivePairwiseAgreement: interAnnotator.decisiveAgreement,
      comparedResumeCount: completeCandidates.length,
    },
    layaVsAnnotator1: annotator1,
    layaVsAnnotator2: annotator2,
    layaVsMeanAnnotatorRank: consensus,
    bm25VsAnnotator1,
    bm25VsAnnotator2,
    bm25VsMeanAnnotatorRank: bm25VsConsensus,
    interpretation:
      'The source task ranks five vacancies within each resume; it does not directly label candidate ordering for a single vacancy.',
  };
}

export function buildVanetikRankingRows(
  results: readonly CandidateMatchResult[],
  dataset: VanetikDataset,
): VanetikRankingRow[] {
  const candidateMap = new Map(
    dataset.candidates.map((candidate) => [toCandidateId(candidate.id), candidate.id]),
  );
  const annotationMap = new Map(
    dataset.annotations.map((annotation) => [toCandidateId(annotation.candidateId), annotation]),
  );
  const jobMap = new Map(dataset.jobs.map((job) => [toJobId(job.id), job]));
  const rows: VanetikRankingRow[] = [];
  for (const job of dataset.jobs) {
    const matches = stableSortByScore(
      results.filter((result) => result.jobId === toJobId(job.id)),
      (result) => result.compositeScore,
    );
    matches.forEach((result, index) => {
      const sourceCandidateId = candidateMap.get(result.candidateId);
      const annotation = sourceCandidateId ? annotationMap.get(result.candidateId) : undefined;
      const resolvedJob = jobMap.get(result.jobId);
      if (!sourceCandidateId || !annotation || !resolvedJob) return;
      const jobIndex = dataset.jobs.findIndex((item) => item.id === job.id);
      const annotator1Rank = annotation.annotator1[jobIndex]!;
      const annotator2Rank = annotation.annotator2[jobIndex]!;
      rows.push({
        vacancyId: job.id,
        vacancyTitle: job.title,
        vacancyRank: index + 1,
        candidateId: sourceCandidateId,
        compositeScore: result.compositeScore,
        skillsScore: result.dimensions.requiredSkills.normalizedScore * 100,
        experienceScore: result.dimensions.relevantExperience.normalizedScore * 100,
        seniorityScore: result.dimensions.seniority.normalizedScore * 100,
        domainScore: result.dimensions.domainMatch.normalizedScore * 100,
        mustHaveProbability: result.dimensions.mustHaves.probability,
        annotator1Rank,
        annotator2Rank,
        meanHumanRank: (annotator1Rank + annotator2Rank) / 2,
      });
    });
  }
  return rows;
}

export function buildVanetikReportSections(
  results: readonly CandidateMatchResult[],
  dataset: VanetikDataset,
): Array<{ heading: string; content: string }> {
  const resultMap = new Map(
    results.map((result) => [`${result.jobId}\0${result.candidateId}`, result]),
  );
  const annotationMap = new Map(
    dataset.annotations.map((annotation) => [annotation.candidateId, annotation]),
  );
  const resumeRows = dataset.candidates.map((candidate) => {
    const values = dataset.jobs.map((job) => ({
      job,
      result: resultMap.get(`${toJobId(job.id)}\0${toCandidateId(candidate.id)}`),
    }));
    const ranked = values
      .filter((value) => value.result)
      .sort((left, right) => right.result!.compositeScore - left.result!.compositeScore);
    const annotation = annotationMap.get(candidate.id)!;
    const humanBest = dataset.jobs
      .map((job, index) => ({
        job,
        rank: Math.min(annotation.annotator1[index]!, annotation.annotator2[index]!),
      }))
      .filter((value) => value.rank === 1)
      .map((value) => value.job.title)
      .join('; ');
    const best = ranked[0];
    return [
      candidate.id,
      humanBest || 'none',
      best?.job.title ?? 'not scored',
      best?.result?.compositeScore.toFixed(2) ?? 'n/a',
    ];
  });

  const scoreRows = dataset.jobs.map((job) => {
    const top = stableSortByScore(
      results.filter((result) => result.jobId === toJobId(job.id)),
      (result) => result.compositeScore,
    ).slice(0, 10);
    return `### ${job.title}\n\n${markdownTable(
      ['Rank', 'Resume ID', 'Laya score'],
      top.map((result, index) => [
        String(index + 1),
        result.candidateId.replace(/^vanetik-/, ''),
        result.compositeScore.toFixed(2),
      ]),
    )}`;
  });

  return [
    {
      heading: 'Model best-vacancy choice per resume',
      content: markdownTable(
        ['Resume', 'Human top vacancy (either annotator)', 'Laya top vacancy', 'Laya score'],
        resumeRows,
      ),
    },
    {
      heading: 'Top 10 resumes per vacancy by Laya score',
      content: `${scoreRows.join('\n\n')}\n\nThese candidate lists are model rankings. The human annotations rank vacancies within each resume, so they do not directly validate a human candidate ranking for each vacancy.`,
    },
  ];
}

export function vanetikRankingsCsv(rows: readonly VanetikRankingRow[]): string {
  const headers = [
    'vacancy_id',
    'vacancy_title',
    'model_rank_for_vacancy',
    'resume_id',
    'laya_composite_score_0_100',
    'laya_skills_score_0_100',
    'laya_experience_score_0_100',
    'laya_seniority_score_0_100',
    'laya_domain_score_0_100',
    'laya_must_have_probability',
    'annotator_1_vacancy_rank',
    'annotator_2_vacancy_rank',
    'mean_vacancy_rank_within_resume',
  ];
  return (
    [
      headers,
      ...rows.map((row) => [
        row.vacancyId,
        row.vacancyTitle,
        row.vacancyRank,
        row.candidateId,
        row.compositeScore.toFixed(4),
        row.skillsScore.toFixed(4),
        row.experienceScore.toFixed(4),
        row.seniorityScore.toFixed(4),
        row.domainScore.toFixed(4),
        row.mustHaveProbability.toFixed(6),
        row.annotator1Rank,
        row.annotator2Rank,
        row.meanHumanRank.toFixed(2),
      ]),
    ]
      .map((row) => row.map(csvCell).join(','))
      .join('\n') + '\n'
  );
}

function evaluateAnnotator(
  candidateScores: readonly number[][],
  completeCandidates: readonly number[],
  annotations: Map<string, VanetikDataset['annotations'][number]>,
  annotator: 'annotator1' | 'annotator2',
): Record<string, number | null> {
  const rows = completeCandidates.map((candidateIndex) => {
    const candidate = `CV-${String(candidateIndex + 1).padStart(2, '0')}`;
    const ranking = annotations.get(candidate)![annotator];
    const scores = candidateScores[candidateIndex]!;
    return rankMetrics(ranking, scores);
  });
  return aggregateRankMetrics(rows);
}

function evaluateConsensus(
  candidateScores: readonly number[][],
  completeCandidates: readonly number[],
  annotations: Map<string, VanetikDataset['annotations'][number]>,
): Record<string, number | null> {
  const rows = completeCandidates.map((candidateIndex) => {
    const candidate = `CV-${String(candidateIndex + 1).padStart(2, '0')}`;
    const annotation = annotations.get(candidate)!;
    const meanRanks = annotation.annotator1.map(
      (rank, index) => (rank + annotation.annotator2[index]!) / 2,
    );
    const scores = candidateScores[candidateIndex]!;
    return rankMetrics(meanRanks, scores);
  });
  return aggregateRankMetrics(rows);
}

function rankMetrics(humanRanks: readonly number[], modelScores: readonly number[]) {
  let agreementCredit = 0;
  let comparisonCount = 0;
  let decisiveCredit = 0;
  let decisiveCount = 0;
  for (let left = 0; left < humanRanks.length; left += 1) {
    for (let right = left + 1; right < humanRanks.length; right += 1) {
      const humanDifference = humanRanks[left]! - humanRanks[right]!;
      const modelDifference = modelScores[left]! - modelScores[right]!;
      comparisonCount += 1;
      if (humanDifference === 0 || modelDifference === 0) {
        agreementCredit += 0.5;
      } else {
        const agrees = Math.sign(humanDifference) !== Math.sign(modelDifference);
        agreementCredit += agrees ? 1 : 0;
      }
      if (humanDifference !== 0) {
        decisiveCount += 1;
        decisiveCredit +=
          modelDifference === 0
            ? 0.5
            : Math.sign(humanDifference) !== Math.sign(modelDifference)
              ? 1
              : 0;
      }
    }
  }
  const humanBest = Math.min(...humanRanks);
  const modelBest = Math.max(...modelScores);
  const topChoiceCorrect = humanRanks.some(
    (rank, index) => rank === humanBest && modelScores[index] === modelBest,
  )
    ? 1
    : 0;
  const relevanceByModelOrder = stableSortByScore(
    modelScores.map((score, index) => ({ score, relevance: 6 - humanRanks[index]! })),
    (entry) => entry.score,
  ).map((entry) => entry.relevance);
  return {
    pairwiseAgreement: comparisonCount ? agreementCredit / comparisonCount : null,
    decisivePairwiseAccuracy: decisiveCount ? decisiveCredit / decisiveCount : null,
    topVacancyAccuracy: topChoiceCorrect,
    spearman: spearmanCorrelation(
      humanRanks.map((rank) => -rank),
      modelScores,
    ),
    ndcgAt5: ndcgAtK(relevanceByModelOrder, 5),
  };
}

function evaluateInterAnnotator(
  completeCandidates: readonly number[],
  annotations: Map<string, VanetikDataset['annotations'][number]>,
): { agreement: number | null; decisiveAgreement: number | null } {
  const metrics = completeCandidates.map((candidateIndex) => {
    const candidate = `CV-${String(candidateIndex + 1).padStart(2, '0')}`;
    const annotation = annotations.get(candidate)!;
    return compareHumanRanks(annotation.annotator1, annotation.annotator2);
  });
  return {
    agreement: meanNullable(metrics.map((metric) => metric.agreement)),
    decisiveAgreement: meanNullable(metrics.map((metric) => metric.decisiveAgreement)),
  };
}

function compareHumanRanks(left: readonly number[], right: readonly number[]) {
  let agreementCredit = 0;
  let comparisonCount = 0;
  let decisiveCredit = 0;
  let decisiveCount = 0;
  for (let first = 0; first < left.length; first += 1) {
    for (let second = first + 1; second < left.length; second += 1) {
      const leftDifference = left[first]! - left[second]!;
      const rightDifference = right[first]! - right[second]!;
      comparisonCount += 1;
      if (leftDifference === 0 || rightDifference === 0) agreementCredit += 0.5;
      else agreementCredit += Math.sign(leftDifference) === Math.sign(rightDifference) ? 1 : 0;
      if (leftDifference !== 0 && rightDifference !== 0) {
        decisiveCount += 1;
        decisiveCredit += Math.sign(leftDifference) === Math.sign(rightDifference) ? 1 : 0;
      }
    }
  }
  return {
    agreement: comparisonCount ? agreementCredit / comparisonCount : null,
    decisiveAgreement: decisiveCount ? decisiveCredit / decisiveCount : null,
  };
}

function aggregateRankMetrics(
  rows: Array<{
    pairwiseAgreement: number | null;
    decisivePairwiseAccuracy: number | null;
    topVacancyAccuracy: number;
    spearman: number | null;
    ndcgAt5: number | null;
  }>,
): Record<string, number | null> {
  return {
    evaluatedResumes: rows.length,
    pairwiseAgreement: meanNullable(rows.map((row) => row.pairwiseAgreement)),
    decisivePairwiseAccuracy: meanNullable(rows.map((row) => row.decisivePairwiseAccuracy)),
    topVacancyAccuracy: mean(rows.map((row) => row.topVacancyAccuracy)),
    meanSpearman: meanNullable(rows.map((row) => row.spearman)),
    meanNdcgAt5: meanNullable(rows.map((row) => row.ndcgAt5)),
  };
}

function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function meanNullable(values: readonly (number | null)[]): number | null {
  return mean(values.filter((value): value is number => value !== null));
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCandidateId(id: string): string {
  return `vanetik-${id}`;
}

function toJobId(id: string): string {
  return `vanetik-vacancy-${id}`;
}
