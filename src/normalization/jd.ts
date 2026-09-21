import { type JobInput, jobInputSchema } from '../domain/types.js';

export function normalizeJobDescription(job: JobInput): JobInput {
  const parsed = jobInputSchema.parse(job);
  const description = normalizeText(parsed.description);
  if (description.length === 0) throw new Error(`Job ${parsed.id} has an empty description`);

  const normalized: JobInput = { ...parsed, description };
  if (parsed.title !== undefined) normalized.title = normalizeText(parsed.title);
  if (parsed.seniority !== undefined) normalized.seniority = normalizeText(parsed.seniority);
  return normalized;
}

export function normalizeText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .split('\n')
    .map((line) => line.replace(/[\t\u00A0 ]+/g, ' ').trim())
    .reduce<string[]>((lines, line) => {
      if (line === '' && lines.at(-1) === '') return lines;
      lines.push(line);
      return lines;
    }, [])
    .join('\n')
    .trim();
}
