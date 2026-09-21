/** A pair of equally sized vectors used by regression and correlation metrics. */
export interface NumericPair {
  readonly actual: readonly number[];
  readonly predicted: readonly number[];
}

/** Per-class counts use rows for actual labels and columns for predicted labels. */
export interface ConfusionMatrix {
  readonly labels: readonly string[];
  readonly counts: readonly (readonly number[])[];
}

/** Standard single-label classification metrics with zero-division set to zero. */
export interface ClassificationMetrics {
  readonly sampleCount: number;
  readonly accuracy: number | null;
  readonly macroPrecision: number | null;
  readonly macroRecall: number | null;
  readonly macroF1: number | null;
  readonly confusionMatrix: ConfusionMatrix;
}

function validateNumericPair(actual: readonly number[], predicted: readonly number[]): void {
  if (actual.length !== predicted.length) {
    throw new RangeError(
      `Expected equally sized vectors; received ${actual.length} and ${predicted.length}`,
    );
  }

  for (let index = 0; index < actual.length; index += 1) {
    if (!Number.isFinite(actual[index]) || !Number.isFinite(predicted[index])) {
      throw new TypeError(`Metric inputs must be finite numbers (invalid value at index ${index})`);
    }
  }
}

/** Returns mean absolute error, or null when there are no observations. */
export function mae(actual: readonly number[], predicted: readonly number[]): number | null {
  validateNumericPair(actual, predicted);
  if (actual.length === 0) return null;

  let total = 0;
  for (let index = 0; index < actual.length; index += 1) {
    total += Math.abs(actual[index]! - predicted[index]!);
  }
  return total / actual.length;
}

/** Returns root mean squared error, or null when there are no observations. */
export function rmse(actual: readonly number[], predicted: readonly number[]): number | null {
  validateNumericPair(actual, predicted);
  if (actual.length === 0) return null;

  let squaredErrorTotal = 0;
  for (let index = 0; index < actual.length; index += 1) {
    const error = actual[index]! - predicted[index]!;
    squaredErrorTotal += error * error;
  }
  return Math.sqrt(squaredErrorTotal / actual.length);
}

/** Pearson product-moment correlation; returns null for fewer than two or constant values. */
export function pearsonCorrelation(
  actual: readonly number[],
  predicted: readonly number[],
): number | null {
  validateNumericPair(actual, predicted);
  if (actual.length < 2) return null;

  const actualMean = mean(actual);
  const predictedMean = mean(predicted);
  let covariance = 0;
  let actualVariance = 0;
  let predictedVariance = 0;

  for (let index = 0; index < actual.length; index += 1) {
    const actualDelta = actual[index]! - actualMean;
    const predictedDelta = predicted[index]! - predictedMean;
    covariance += actualDelta * predictedDelta;
    actualVariance += actualDelta * actualDelta;
    predictedVariance += predictedDelta * predictedDelta;
  }

  if (actualVariance === 0 || predictedVariance === 0) return null;
  return clampCorrelation(covariance / Math.sqrt(actualVariance * predictedVariance));
}

/** Spearman rank correlation using average ranks for ties. */
export function spearmanCorrelation(
  actual: readonly number[],
  predicted: readonly number[],
): number | null {
  validateNumericPair(actual, predicted);
  if (actual.length < 2) return null;
  return pearsonCorrelation(averageRanks(actual), averageRanks(predicted));
}

/**
 * Builds a confusion matrix and accuracy/macro metrics. Labels default to the
 * stable first-seen union of actual then predicted values. Per-class zero
 * precision or recall contributes zero to the macro average.
 */
export function classificationMetrics(
  actual: readonly string[],
  predicted: readonly string[],
  options: { readonly labels?: readonly string[] } = {},
): ClassificationMetrics {
  if (actual.length !== predicted.length) {
    throw new RangeError(
      `Expected equally sized label vectors; received ${actual.length} and ${predicted.length}`,
    );
  }

  const labels =
    options.labels === undefined ? uniqueInOrder([...actual, ...predicted]) : [...options.labels];
  if (new Set(labels).size !== labels.length) {
    throw new RangeError('Classification labels must not contain duplicates');
  }

  const labelIndexes = new Map(labels.map((label, index) => [label, index]));
  const counts = labels.map(() => labels.map(() => 0));
  let correct = 0;

  for (let index = 0; index < actual.length; index += 1) {
    const actualIndex = labelIndexes.get(actual[index]!);
    const predictedIndex = labelIndexes.get(predicted[index]!);
    if (actualIndex === undefined || predictedIndex === undefined) {
      throw new RangeError(`Observed class is missing from the provided labels at index ${index}`);
    }
    counts[actualIndex]![predictedIndex] = counts[actualIndex]![predictedIndex]! + 1;
    if (actualIndex === predictedIndex) correct += 1;
  }

  if (actual.length === 0) {
    return {
      sampleCount: 0,
      accuracy: null,
      macroPrecision: null,
      macroRecall: null,
      macroF1: null,
      confusionMatrix: { labels, counts },
    };
  }

  let precisionTotal = 0;
  let recallTotal = 0;
  let f1Total = 0;
  for (let classIndex = 0; classIndex < labels.length; classIndex += 1) {
    const truePositive = counts[classIndex]![classIndex]!;
    const predictedCount = counts.reduce((sum, row) => sum + row[classIndex]!, 0);
    const actualCount = counts[classIndex]!.reduce((sum, count) => sum + count, 0);
    const precision = predictedCount === 0 ? 0 : truePositive / predictedCount;
    const recall = actualCount === 0 ? 0 : truePositive / actualCount;
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    precisionTotal += precision;
    recallTotal += recall;
    f1Total += f1;
  }

  const classCount = labels.length;
  return {
    sampleCount: actual.length,
    accuracy: correct / actual.length,
    macroPrecision: classCount === 0 ? 0 : precisionTotal / classCount,
    macroRecall: classCount === 0 ? 0 : recallTotal / classCount,
    macroF1: classCount === 0 ? 0 : f1Total / classCount,
    confusionMatrix: { labels, counts },
  };
}

/**
 * NDCG for relevance grades already arranged in predicted rank order. Uses
 * exponential gain (2^relevance - 1); returns null for an empty list or when
 * every available relevance grade is zero.
 */
export function ndcgAtK(rankedRelevances: readonly number[], k: number): number | null {
  validateK(k);
  validateRelevances(rankedRelevances);
  if (rankedRelevances.length === 0) return null;

  const count = Math.min(k, rankedRelevances.length);
  const actualDcg = discountedGain(rankedRelevances.slice(0, count));
  const idealDcg = discountedGain(
    [...rankedRelevances].sort((left, right) => right - left).slice(0, count),
  );
  return idealDcg === 0 ? null : actualDcg / idealDcg;
}

/**
 * Precision for relevance grades already arranged in predicted rank order.
 * The denominator is the number of available entries up to k. Returns null
 * for an empty ranking; relevance equal to the threshold is considered relevant.
 */
export function precisionAtK(
  rankedRelevances: readonly number[],
  k: number,
  relevanceThreshold = 1,
): number | null {
  validateK(k);
  validateRelevances(rankedRelevances);
  if (!Number.isFinite(relevanceThreshold))
    throw new TypeError('Relevance threshold must be finite');
  const count = Math.min(k, rankedRelevances.length);
  if (count === 0) return null;

  let relevantCount = 0;
  for (let index = 0; index < count; index += 1) {
    if (rankedRelevances[index]! >= relevanceThreshold) relevantCount += 1;
  }
  return relevantCount / count;
}

/**
 * Fraction of differently graded candidate pairs ordered correctly by scores.
 * Pairs tied in the actual labels are ignored; a predicted score tie earns
 * half credit. Returns null when there is no comparable pair.
 */
export function pairwiseOrderingAccuracy(
  actualRelevances: readonly number[],
  predictedScores: readonly number[],
): number | null {
  validateNumericPair(actualRelevances, predictedScores);
  let comparablePairs = 0;
  let correctPairCredits = 0;

  for (let left = 0; left < actualRelevances.length; left += 1) {
    for (let right = left + 1; right < actualRelevances.length; right += 1) {
      const actualDelta = actualRelevances[left]! - actualRelevances[right]!;
      if (actualDelta === 0) continue;
      comparablePairs += 1;
      const predictedDelta = predictedScores[left]! - predictedScores[right]!;
      if (predictedDelta === 0) correctPairCredits += 0.5;
      else if (Math.sign(actualDelta) === Math.sign(predictedDelta)) correctPairCredits += 1;
    }
  }

  return comparablePairs === 0 ? null : correctPairCredits / comparablePairs;
}

/** Sorts by descending score while preserving original order for ties. */
export function stableSortByScore<T>(items: readonly T[], getScore: (item: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index, score: getScore(item) }))
    .map((entry) => {
      if (!Number.isFinite(entry.score))
        throw new TypeError('Ranking scores must be finite numbers');
      return entry;
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ item }) => item);
}

/** Long-form alias for callers that prefer descriptive metric names. */
export const meanAbsoluteError = mae;

/** Long-form alias for callers that prefer descriptive metric names. */
export const rootMeanSquaredError = rmse;

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function averageRanks(values: readonly number[]): number[] {
  const sorted = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value || left.index - right.index);
  const ranks = new Array<number>(values.length);

  let start = 0;
  while (start < sorted.length) {
    let end = start + 1;
    while (end < sorted.length && sorted[end]!.value === sorted[start]!.value) end += 1;
    const averageRank = (start + 1 + end) / 2;
    for (let index = start; index < end; index += 1) ranks[sorted[index]!.index] = averageRank;
    start = end;
  }
  return ranks;
}

function clampCorrelation(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function uniqueInOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function validateK(k: number): void {
  if (!Number.isInteger(k) || k <= 0) throw new RangeError('k must be a positive integer');
}

function validateRelevances(relevances: readonly number[]): void {
  for (let index = 0; index < relevances.length; index += 1) {
    if (!Number.isFinite(relevances[index]) || relevances[index]! < 0) {
      throw new TypeError(
        `Relevance grades must be finite non-negative numbers (invalid value at index ${index})`,
      );
    }
  }
}

function discountedGain(relevances: readonly number[]): number {
  let total = 0;
  for (let index = 0; index < relevances.length; index += 1) {
    total += (2 ** relevances[index]! - 1) / Math.log2(index + 2);
  }
  return total;
}
