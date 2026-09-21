import { readFile } from 'node:fs/promises';
import { normalizeResumeText } from '../normalization/resume.js';

export interface PdfTextResult {
  text: string;
  pageCount: number;
  status: 'parsed' | 'requires_ocr';
}

export async function extractPdfText(filePath: string): Promise<PdfTextResult> {
  const data = new Uint8Array(await readFile(filePath));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data, verbosity: 0 }).promise;
  const pageTexts: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .flatMap((item) => ('str' in item && typeof item.str === 'string' ? [item.str] : []))
      .join(' ');
    pageTexts.push(text);
  }
  const text = normalizeResumeText(pageTexts.join('\n\n'));
  return {
    text,
    pageCount: document.numPages,
    status: text.replace(/\s/g, '').length < 80 ? 'requires_ocr' : 'parsed',
  };
}

export function tokenJaccard(left: string, right: string): number | null {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return null;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  return intersection / (leftTokens.size + rightTokens.size - intersection);
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
}
