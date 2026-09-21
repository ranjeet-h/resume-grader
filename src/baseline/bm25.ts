import { stableSortByScore } from '../metrics/core.js';

/** BM25 tuning parameters. Defaults follow common short-document retrieval settings. */
export interface Bm25Options {
  readonly k1?: number;
  readonly b?: number;
}

/** A document to rank; text should already have passed application normalization. */
export interface Bm25Document {
  readonly id: string;
  readonly text: string;
}

/** A ranked result deliberately excludes resume text. Rank is one-based. */
export interface Bm25RankedDocument {
  readonly id: string;
  readonly score: number;
  readonly rank: number;
}

const DEFAULT_K1 = 1.2;
const DEFAULT_B = 0.75;
const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;

/**
 * Scores one document against a query using corpus-level BM25 statistics.
 * If omitted, the corpus consists only of the scored document. Text is assumed
 * to be normalized upstream; tokenization applies Unicode compatibility
 * normalization and lowercasing. Repeated query terms contribute repeatedly.
 */
export function bm25Score(
  queryText: string,
  documentText: string,
  corpusTexts: readonly string[] = [documentText],
  options: Bm25Options = {},
): number {
  const { k1, b } = resolveOptions(options);
  const queryTerms = tokenize(queryText);
  const documentTerms = tokenize(documentText);
  if (queryTerms.length === 0 || documentTerms.length === 0) return 0;

  const corpus = corpusTexts.length === 0 ? [documentText] : corpusTexts;
  const corpusTokens = corpus.map(tokenize);
  const averageDocumentLength =
    corpusTokens.reduce((sum, tokens) => sum + tokens.length, 0) / corpusTokens.length;
  if (averageDocumentLength === 0) return 0;

  const documentFrequency = new Map<string, number>();
  for (const tokens of corpusTokens) {
    for (const term of new Set(tokens))
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }

  const termFrequency = frequencies(documentTerms);
  let score = 0;
  for (const term of queryTerms) {
    const frequency = termFrequency.get(term) ?? 0;
    if (frequency === 0) continue;

    const docFrequency = documentFrequency.get(term) ?? 0;
    const inverseDocumentFrequency = Math.log(
      1 + (corpus.length - docFrequency + 0.5) / (docFrequency + 0.5),
    );
    const lengthNormalization = k1 * (1 - b + b * (documentTerms.length / averageDocumentLength));
    const termSaturation = (frequency * (k1 + 1)) / (frequency + lengthNormalization);
    score += inverseDocumentFrequency * termSaturation;
  }
  return score;
}

/**
 * Ranks normalized resume texts for a normalized job description. Equal BM25
 * scores preserve the documents' input order for reproducible results.
 */
export function rankByBm25(
  queryText: string,
  documents: readonly Bm25Document[],
  options: Bm25Options = {},
): Bm25RankedDocument[] {
  const corpus = documents.map(({ text }) => text);
  const scored = documents.map((document, index) => ({
    id: document.id,
    score: bm25Score(queryText, document.text, corpus, options),
    index,
  }));
  const ranked = stableSortByScore(scored, ({ score }) => score);
  return ranked.map(({ id, score }, index) => ({ id, score, rank: index + 1 }));
}

function resolveOptions(options: Bm25Options): { readonly k1: number; readonly b: number } {
  const k1 = options.k1 ?? DEFAULT_K1;
  const b = options.b ?? DEFAULT_B;
  if (!Number.isFinite(k1) || k1 < 0)
    throw new RangeError('BM25 k1 must be a finite non-negative number');
  if (!Number.isFinite(b) || b < 0 || b > 1)
    throw new RangeError('BM25 b must be a finite number from 0 to 1');
  return { k1, b };
}

function tokenize(text: string): string[] {
  return text.normalize('NFKC').toLowerCase().match(TOKEN_PATTERN) ?? [];
}

function frequencies(tokens: readonly string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const token of tokens) result.set(token, (result.get(token) ?? 0) + 1);
  return result;
}
