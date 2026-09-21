import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { type CandidateInput, candidateInputSchema } from '../domain/types.js';
import { normalizeResumeText } from '../normalization/resume.js';
import { extractPdfText, type PdfTextResult } from './pdf.js';

export const MAX_RESUME_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_RESUME_DIRECTORY_BYTES = 512 * 1024 * 1024;
const MIN_RESUME_TEXT_CHARACTERS = 80;

export interface LocalResumeInput {
  candidate: CandidateInput;
  sourcePath: string;
  relativePath: string;
  sha256: string;
  pageCount?: number;
}

export async function hashLocalMatchInputs(
  jobFile: string,
  resumes: readonly LocalResumeInput[],
): Promise<string> {
  const hash = createHash('sha256');
  hash.update('job\0').update(await readFile(jobFile));
  for (const resume of resumes) {
    hash.update('\0resume\0').update(resume.relativePath).update('\0').update(resume.sha256);
  }
  return hash.digest('hex');
}

export async function loadLocalResumes(directory: string): Promise<LocalResumeInput[]> {
  const root = path.resolve(directory);
  const files: string[] = [];
  const unsupportedExtensions = new Set<string>();

  const visit = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    )) {
      if (entry.name.startsWith('.')) continue;
      const sourcePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(sourcePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (extension === '.pdf' || extension === '.txt') files.push(sourcePath);
      else unsupportedExtensions.add(extension || '[no extension]');
    }
  };

  await visit(root);
  if (unsupportedExtensions.size > 0) {
    throw new Error(
      `Resume directory contains unsupported files (${[...unsupportedExtensions].sort().join(', ')}). Use PDF or TXT files only; no resumes were evaluated.`,
    );
  }
  if (files.length === 0) {
    throw new Error(`No PDF or TXT resumes were found in ${root}.`);
  }
  const fileStats = await Promise.all(files.map((sourcePath) => stat(sourcePath)));
  const totalBytes = fileStats.reduce((total, fileInfo) => total + fileInfo.size, 0);
  if (totalBytes > MAX_RESUME_DIRECTORY_BYTES) {
    throw new Error(
      'Resume directory exceeds the 512 MiB input safety limit; no resumes were evaluated.',
    );
  }

  const resumes: LocalResumeInput[] = [];
  const ids = new Set<string>();
  for (const [index, sourcePath] of files.entries()) {
    const fileInfo = fileStats[index];
    if (!fileInfo) throw new Error('Could not inspect one of the resume files.');
    if (fileInfo.size === 0) throw new Error(`Resume file ${index + 1} is empty.`);
    if (fileInfo.size > MAX_RESUME_FILE_BYTES) {
      throw new Error(
        `Resume file ${index + 1} exceeds the 25 MiB safety limit; no resumes were evaluated.`,
      );
    }

    let resumeText: string;
    let pageCount: number | undefined;
    if (path.extname(sourcePath).toLowerCase() === '.pdf') {
      let parsed: PdfTextResult;
      try {
        parsed = await extractPdfText(sourcePath);
      } catch {
        throw new Error(
          `Resume file ${index + 1} could not be parsed as a PDF; no resumes were evaluated.`,
        );
      }
      if (parsed.status !== 'parsed') {
        throw new Error(
          `Resume file ${index + 1} has no usable embedded PDF text. Scanned PDFs need OCR before matching; no resumes were evaluated.`,
        );
      }
      resumeText = parsed.text;
      pageCount = parsed.pageCount;
    } else {
      resumeText = normalizeResumeText(await readFile(sourcePath, 'utf8'));
    }

    if (resumeText.length < MIN_RESUME_TEXT_CHARACTERS) {
      throw new Error(
        `Resume file ${index + 1} contains fewer than ${MIN_RESUME_TEXT_CHARACTERS} readable characters; no resumes were evaluated.`,
      );
    }

    const relativePath = path.relative(root, sourcePath);
    const id = `candidate-${String(index + 1).padStart(4, '0')}`;
    if (ids.has(id)) throw new Error('Could not assign unique IDs to the selected resumes.');
    ids.add(id);
    const bytes = await readFile(sourcePath);
    const input: LocalResumeInput = {
      candidate: candidateInputSchema.parse({ id, resumeText, source: 'custom' }),
      sourcePath,
      relativePath,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    if (pageCount !== undefined) input.pageCount = pageCount;
    resumes.push(input);
  }
  return resumes;
}
