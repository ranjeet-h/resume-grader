import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { normalizeText } from '../normalization/jd.js';
import { normalizeResumeText } from '../normalization/resume.js';
import { asRecord, hashFiles } from './shared.js';
import type { KaggleDataset, KaggleResumeRow, ParseIssue } from './types.js';

export async function loadKaggleDataset(rawDir: string): Promise<KaggleDataset> {
  const datasetDir = path.join(rawDir, 'kaggle-resumes');
  const csvPath = path.join(datasetDir, 'Resume.csv');
  const contents = await readFile(csvPath, 'utf8');
  const records = parse(contents, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as unknown[];
  const rows: KaggleResumeRow[] = [];
  const issues: ParseIssue[] = [];

  records.forEach((value, index) => {
    const row = asRecord(value);
    const sourceRow = index + 2;
    if (!row) {
      issues.push({ sourceRow, reason: 'row is not an object' });
      return;
    }
    const id = stringValue(row, ['ID', 'id']);
    const rawText =
      stringValue(row, ['Resume_str', 'resume_text']) ??
      stripHtml(stringValue(row, ['Resume_html']) ?? '');
    const resumeText = normalizeResumeText(rawText);
    if (!id) {
      issues.push({ sourceRow, reason: 'missing ID' });
      return;
    }
    if (resumeText.length === 0) {
      issues.push({ sourceRow, reason: 'resume text is empty after normalization' });
      return;
    }
    const category = stringValue(row, ['Category', 'category']);
    const candidate: KaggleResumeRow = { id, resumeText, sourceRow };
    if (category) candidate.category = category;
    rows.push(candidate);
  });

  const pdfRoot = path.join(datasetDir, 'data');
  return {
    rows,
    issues,
    csvPath,
    pdfRoot,
    datasetVersionOrHash: await hashFiles([csvPath]),
  };
}

export async function writeNormalizedKaggle(
  dataset: KaggleDataset,
  outputPath: string,
): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(
    outputPath,
    JSON.stringify(
      {
        datasetVersionOrHash: dataset.datasetVersionOrHash,
        rows: dataset.rows,
        issues: dataset.issues,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}

export async function findKagglePdfFiles(pdfRoot: string): Promise<Map<string, string>> {
  const byId = new Map<string, string>();
  const visit = async (directory: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
        const id = path.basename(entry.name, path.extname(entry.name));
        if (!byId.has(id)) byId.set(id, fullPath);
      }
    }
  };
  await visit(pdfRoot);
  return byId;
}

function stringValue(row: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function stripHtml(html: string): string {
  return normalizeText(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<\/(?:p|div|li|h[1-6]|tr|section)>/gi, '\n')
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'"),
  );
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
