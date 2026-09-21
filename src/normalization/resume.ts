import { type CandidateInput, candidateInputSchema } from '../domain/types.js';
import { normalizeText } from './jd.js';
import { redactSensitiveResumeText } from './redact.js';

const PAGE_MARKER = /^\s*(?:page\s+)?\d+\s*(?:of\s+\d+)?\s*$/i;

export function normalizeResumeText(resumeText: string): string {
  const normalized = normalizeText(resumeText.replace(/\f/g, '\n\n'));
  if (!normalized) return '';

  const lines = normalized.split('\n');
  const meaningful = lines.filter((line) => line.length > 0);
  const repeated = new Set<string>();
  const countByLine = new Map<string, number>();
  for (const line of meaningful) countByLine.set(line, (countByLine.get(line) ?? 0) + 1);
  for (const [line, count] of countByLine) {
    if (count >= 3 && line.length <= 100) repeated.add(line);
  }

  return lines
    .filter((line) => !PAGE_MARKER.test(line) && !repeated.has(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeCandidate(candidate: CandidateInput): CandidateInput {
  const parsed = candidateInputSchema.parse(candidate);
  const normalized: CandidateInput = {
    ...parsed,
    resumeText: redactSensitiveResumeText(normalizeResumeText(parsed.resumeText)),
  };
  return normalized;
}
