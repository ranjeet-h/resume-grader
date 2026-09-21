import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { joinRoleRadarLabels } from '../../src/benchmarks/role-radar.js';
import { loadAtsValidationDataset } from '../../src/datasets/ats-score.js';
import { findKagglePdfFiles, loadKaggleDataset } from '../../src/datasets/kaggle.js';
import { loadRoleRadarDataset } from '../../src/datasets/role-radar.js';

const temporaryDirectories: string[] = [];

async function temporaryRoot(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'laya-data-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('local dataset adapters', () => {
  it('loads ATS rows split on the literal resume/JD delimiter and reports malformed rows', async () => {
    const root = await temporaryRoot();
    const directory = path.join(root, 'ats-score');
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, 'validation.csv'),
      'text,ats_score,original_label\n"Built APIs SEP Build APIs",75,Good Fit\n"Missing delimiter",30,No Fit\n',
    );
    const dataset = await loadAtsValidationDataset(root);
    expect(dataset.rows).toHaveLength(1);
    expect(dataset.rows[0]?.resumeText).toBe('Built APIs');
    expect(dataset.rows[0]?.jobDescription).toBe('Build APIs');
    expect(dataset.issues).toHaveLength(1);
  });

  it('loads Kaggle text/HTML fields and recursively finds local PDFs', async () => {
    const root = await temporaryRoot();
    const directory = path.join(root, 'kaggle-resumes');
    await mkdir(path.join(directory, 'data', 'Engineering'), { recursive: true });
    await writeFile(
      path.join(directory, 'Resume.csv'),
      'ID,Resume_str,Resume_html,Category\n1,"TypeScript engineer",,Engineering\n2,,"<p>Backend developer</p>",IT\n',
    );
    await writeFile(path.join(directory, 'data', 'Engineering', '1.pdf'), '%PDF-fixture');
    const dataset = await loadKaggleDataset(root);
    const pdfs = await findKagglePdfFiles(dataset.pdfRoot);
    expect(dataset.rows.map((row) => row.resumeText)).toEqual([
      'TypeScript engineer',
      'Backend developer',
    ]);
    expect(pdfs.get('1')).toBe(path.join(directory, 'data', 'Engineering', '1.pdf'));
  });

  it('resolves Role Radar pair IDs with underscore-containing job IDs and joins labels', async () => {
    const root = await temporaryRoot();
    const directory = path.join(root, 'role-radar');
    await mkdir(directory, { recursive: true });
    const files: Record<string, unknown> = {
      'scraped_jobs.json': [{ id: 'job_1', title: 'Backend Engineer', description: 'Build APIs' }],
      'synthetic_profiles.json': [
        { profile_id: 'c1', resume_text: 'Backend engineer with API experience' },
      ],
      'phase2_pairs.json': [{ pair_id: 'c1_job_1' }],
      'phase2_labels.json': [{ pair_id: 'c1_job_1', composite: 81 }],
      'phase3_pairs.json': [{ pair_id: 'c1_job_1' }],
      'phase3_labels.json': [{ pair_id: 'c1_job_1', composite: 81, skills: 90 }],
      'gold_labels.json': [
        { pair_id: 'c1_job_1', composite: 81, reasoning: 'Relevant experience' },
      ],
    };
    for (const [filename, contents] of Object.entries(files)) {
      await writeFile(path.join(directory, filename), JSON.stringify(contents));
    }
    const data = await loadRoleRadarDataset(root);
    const joined = joinRoleRadarLabels(data, data.phase3Labels);
    expect(data.jobs).toHaveLength(1);
    expect(data.candidates).toHaveLength(1);
    expect(joined.pairs).toHaveLength(1);
    expect(joined.pairs[0]?.input.job.id).toBe('job_1');
    expect(joined.pairs[0]?.label.composite).toBe(81);
  });
});
