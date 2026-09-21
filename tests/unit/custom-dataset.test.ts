import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashLocalMatchInputs, loadLocalResumes } from '../../src/datasets/custom.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'resume-matcher-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('local resume dataset', () => {
  it('loads TXT resumes with anonymous stable IDs and hashes relative inputs', async () => {
    const root = await createDirectory();
    const resumesDir = path.join(root, 'resumes');
    await mkdir(resumesDir);
    await writeFile(
      path.join(resumesDir, 'candidate-a.txt'),
      'Full stack engineer with professional experience building Node.js, React, and TypeScript products. '.repeat(
        3,
      ),
    );
    await writeFile(
      path.join(resumesDir, 'candidate-b.txt'),
      'Backend engineer with professional experience building Python, APIs, and SQL products. '.repeat(
        3,
      ),
    );
    const jobFile = path.join(root, 'job.json');
    await writeFile(jobFile, '{"id":"job-1","description":"Software engineer"}');

    const resumes = await loadLocalResumes(resumesDir);
    expect(resumes.map(({ candidate }) => candidate.id)).toEqual([
      'candidate-0001',
      'candidate-0002',
    ]);
    expect(resumes[0]?.candidate.resumeText).toContain('Full stack engineer');
    expect(resumes[0]?.relativePath).toBe('candidate-a.txt');
    expect(resumes[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(hashLocalMatchInputs(jobFile, resumes)).resolves.toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects unsupported inputs before scoring instead of silently skipping resumes', async () => {
    const root = await createDirectory();
    await writeFile(path.join(root, 'candidate.docx'), 'not supported');
    await expect(loadLocalResumes(root)).rejects.toThrow(/Use PDF or TXT files only/);
  });

  it('rejects undersized resume text before scoring', async () => {
    const root = await createDirectory();
    await writeFile(path.join(root, 'candidate.txt'), 'Too short.');
    await expect(loadLocalResumes(root)).rejects.toThrow(/no resumes were evaluated/);
  });
});
