import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function writeJsonReport(directory: string, report: unknown): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const reportPath = path.join(directory, 'report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return reportPath;
}
