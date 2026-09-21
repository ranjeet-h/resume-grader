import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface MarkdownReportInput {
  title: string;
  sections: ReadonlyArray<{ heading: string; content: string }>;
}

export async function writeMarkdownReport(
  directory: string,
  report: MarkdownReportInput,
): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const reportPath = path.join(directory, 'report.md');
  const contents = [
    `# ${report.title}`,
    ...report.sections.flatMap(({ heading, content }) => [`## ${heading}`, content.trim(), '']),
  ].join('\n');
  await writeFile(reportPath, `${contents.trim()}\n`, { mode: 0o600 });
  return reportPath;
}

export function markdownTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const escapeCell = (value: string): string => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [
    `| ${headers.map(escapeCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`),
  ].join('\n');
}

export function formatMetric(value: number | null | undefined, digits = 4): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? 'not available'
    : value.toFixed(digits);
}
