import { describe, expect, it } from 'vitest';
import { bm25Score, rankByBm25 } from '../../src/baseline/bm25.js';
import {
  classificationMetrics,
  mae,
  ndcgAtK,
  pairwiseOrderingAccuracy,
  pearsonCorrelation,
  precisionAtK,
  rmse,
  spearmanCorrelation,
  stableSortByScore,
} from '../../src/metrics/core.js';

describe('continuous metrics', () => {
  it('calculates MAE and RMSE', () => {
    expect(mae([3, -0.5, 2, 7], [2.5, 0, 2, 8])).toBe(0.5);
    expect(rmse([3, -0.5, 2, 7], [2.5, 0, 2, 8])).toBeCloseTo(Math.sqrt(0.375));
  });

  it('returns null for empty error vectors and rejects mismatched vectors', () => {
    expect(mae([], [])).toBeNull();
    expect(rmse([], [])).toBeNull();
    expect(() => mae([1], [])).toThrow(RangeError);
  });

  it('calculates Pearson and Spearman correlations', () => {
    expect(pearsonCorrelation([1, 2, 3], [4, 5, 6])).toBeCloseTo(1);
    expect(pearsonCorrelation([1, 2, 3], [6, 5, 4])).toBeCloseTo(-1);
    expect(spearmanCorrelation([1, 2, 3], [40, 10, 20])).toBeCloseTo(-0.5);
    expect(spearmanCorrelation([1, 2, 2, 4], [10, 20, 20, 30])).toBeCloseTo(1);
  });

  it('reports undefined correlation for short or constant vectors', () => {
    expect(pearsonCorrelation([], [])).toBeNull();
    expect(spearmanCorrelation([1], [1])).toBeNull();
    expect(pearsonCorrelation([2, 2], [1, 4])).toBeNull();
    expect(spearmanCorrelation([1, 2], [9, 9])).toBeNull();
  });
});

describe('classification metrics', () => {
  it('returns confusion counts and macro scores in stable label order', () => {
    const result = classificationMetrics(['yes', 'no', 'yes', 'no'], ['yes', 'yes', 'no', 'no']);
    expect(result.confusionMatrix.labels).toEqual(['yes', 'no']);
    expect(result.confusionMatrix.counts).toEqual([
      [1, 1],
      [1, 1],
    ]);
    expect(result.accuracy).toBe(0.5);
    expect(result.macroPrecision).toBe(0.5);
    expect(result.macroRecall).toBe(0.5);
    expect(result.macroF1).toBe(0.5);
  });

  it('supports an explicit class set and empty input', () => {
    const result = classificationMetrics(['a'], ['a'], { labels: ['a', 'b'] });
    expect(result.macroPrecision).toBe(0.5);
    expect(result.macroRecall).toBe(0.5);
    expect(result.macroF1).toBe(0.5);
    expect(classificationMetrics([], []).accuracy).toBeNull();
    expect(classificationMetrics([], [], { labels: ['a'] }).confusionMatrix.counts).toEqual([[0]]);
  });

  it('rejects mismatched vectors, duplicate labels, and omitted observed classes', () => {
    expect(() => classificationMetrics(['a'], [])).toThrow(RangeError);
    expect(() => classificationMetrics(['a'], ['a'], { labels: ['a', 'a'] })).toThrow(RangeError);
    expect(() => classificationMetrics(['a'], ['a'], { labels: ['b'] })).toThrow(RangeError);
  });
});

describe('ranking metrics and stable ordering', () => {
  it('calculates NDCG and precision at k', () => {
    expect(ndcgAtK([3, 2, 0], 2)).toBe(1);
    expect(ndcgAtK([0, 3, 2], 2)).toBeLessThan(1);
    expect(precisionAtK([0, 2, 1], 2)).toBe(0.5);
    expect(precisionAtK([1, 0, 2], 10)).toBeCloseTo(2 / 3);
  });

  it('handles empty or uninformative rankings and invalid k explicitly', () => {
    expect(ndcgAtK([], 5)).toBeNull();
    expect(ndcgAtK([0, 0], 2)).toBeNull();
    expect(precisionAtK([], 5)).toBeNull();
    expect(() => precisionAtK([1], 0)).toThrow(RangeError);
    expect(() => ndcgAtK([-1], 1)).toThrow(TypeError);
  });

  it('scores pairwise ordering with half credit for predicted ties', () => {
    expect(pairwiseOrderingAccuracy([3, 2, 1], [0.9, 0.5, 0.1])).toBe(1);
    expect(pairwiseOrderingAccuracy([3, 2, 1], [0.9, 0.9, 0.1])).toBeCloseTo(5 / 6);
    expect(pairwiseOrderingAccuracy([1, 1], [3, 2])).toBeNull();
    expect(pairwiseOrderingAccuracy([], [])).toBeNull();
  });

  it('preserves input order for exact score ties', () => {
    const items = [
      { id: 'first', score: 2 },
      { id: 'second', score: 2 },
      { id: 'third', score: 4 },
    ];
    expect(stableSortByScore(items, ({ score }) => score).map(({ id }) => id)).toEqual([
      'third',
      'first',
      'second',
    ]);
    expect(stableSortByScore([], () => 0)).toEqual([]);
  });
});

describe('BM25 baseline', () => {
  const documents = [
    { id: 'full-match', text: 'TypeScript Node.js API design backend' },
    { id: 'partial-match', text: 'TypeScript frontend application' },
    { id: 'no-match', text: 'accounting finance payroll' },
  ];

  it('scores matching terms and returns zero for empty or unmatched text', () => {
    expect(
      bm25Score(
        'typescript backend',
        documents[0]!.text,
        documents.map(({ text }) => text),
      ),
    ).toBeGreaterThan(0);
    expect(
      bm25Score(
        'typescript backend',
        documents[2]!.text,
        documents.map(({ text }) => text),
      ),
    ).toBe(0);
    expect(bm25Score('!!!', documents[0]!.text)).toBe(0);
    expect(bm25Score('typescript', '   ')).toBe(0);
  });

  it('ranks by BM25 and keeps input order for tied zero scores', () => {
    const ranked = rankByBm25('typescript backend', documents);
    expect(ranked.map(({ id }) => id)).toEqual(['full-match', 'partial-match', 'no-match']);
    expect(ranked.map(({ rank }) => rank)).toEqual([1, 2, 3]);
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);

    const tied = rankByBm25('nonexistent', documents);
    expect(tied.map(({ id }) => id)).toEqual(documents.map(({ id }) => id));
    expect(tied.every(({ score }) => score === 0)).toBe(true);
  });

  it('validates BM25 options', () => {
    expect(() => bm25Score('query', 'document', ['document'], { b: 2 })).toThrow(RangeError);
    expect(() => bm25Score('query', 'document', ['document'], { k1: -1 })).toThrow(RangeError);
  });
});
