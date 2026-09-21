import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { normalizeText } from '../normalization/jd.js';
import { normalizeResumeText } from '../normalization/resume.js';
import { asRecord, hashFiles, type JsonRecord } from './shared.js';
import type { AtsDataset, AtsValidationRow, ParseIssue } from './types.js';

export async function loadAtsValidationDataset(rawDir: string): Promise<AtsDataset> {
  const sourceFile = path.join(rawDir, 'ats-score', 'validation.csv');
  const contents = await readFile(sourceFile, 'utf8');
  const records = parse(contents, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as unknown[];
  const rows: AtsValidationRow[] = [];
  const issues: ParseIssue[] = [];

  records.forEach((value, index) => {
    const row = asRecord(value);
    const sourceRow = index + 2;
    if (!row) {
      issues.push({ sourceRow, reason: 'row is not an object' });
      return;
    }
    const text = typeof row['text'] === 'string' ? row['text'] : '';
    const separator = text.indexOf(' SEP ');
    if (separator < 0) {
      issues.push({ sourceRow, reason: 'text field is missing the literal ` SEP ` delimiter' });
      return;
    }
    const resumeText = normalizeResumeText(text.slice(0, separator));
    const jobDescription = normalizeText(text.slice(separator + 5));
    const atsScore = parseNumber(row, 'ats_score');
    if (resumeText.length === 0 || jobDescription.length === 0) {
      issues.push({ sourceRow, reason: 'resume or job description is empty after normalization' });
      return;
    }
    if (atsScore === undefined) {
      issues.push({ sourceRow, reason: 'ats_score is not a finite number' });
      return;
    }

    const parsedRow: AtsValidationRow = {
      id: `ats-validation-${sourceRow}`,
      resumeText,
      jobDescription,
      atsScore,
      sourceRow,
    };
    if (typeof row['original_label'] === 'string') parsedRow.originalLabel = row['original_label'];
    rows.push(parsedRow);
  });

  return {
    rows,
    issues,
    datasetVersionOrHash: await hashFiles([sourceFile]),
    sourceFile,
  };
}

export async function writeNormalizedAts(dataset: AtsDataset, outputPath: string): Promise<void> {
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

function parseNumber(row: JsonRecord, field: string): number | undefined {
  const value = row[field];
  const number =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}
