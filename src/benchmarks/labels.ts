export type FitLabel = 'No Fit' | 'Potential Fit' | 'Good Fit';

export function classifyAtsScore(score: number): FitLabel {
  if (!Number.isFinite(score)) throw new TypeError('ATS score must be finite');
  if (score < 40) return 'No Fit';
  if (score <= 70) return 'Potential Fit';
  return 'Good Fit';
}
