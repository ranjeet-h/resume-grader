import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../src/config.js';
import { createCandidateEvaluator } from '../../src/providers/factory.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function pluginConfig(adapterModule: string): AppConfig {
  return {
    rootDir: path.dirname(adapterModule),
    rawDir: '',
    normalizedDir: '',
    outputDir: '',
    cacheDir: '',
    provider: 'test-local',
    model: 'test/model@revision-1',
    adapterModule,
  };
}

describe('evaluator plugin loading', () => {
  it('loads the selected local plugin and verifies its configured model identity', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'resume-matcher-plugin-'));
    temporaryDirectories.push(directory);
    const modulePath = path.join(directory, 'adapter.mjs');
    await writeFile(
      modulePath,
      `export function createEvaluator(config) {
        return { evaluate: async (input) => ({
          model: config.model,
          candidateId: input.candidate.id,
          jobId: input.job.id,
          compositeScore: 75,
          latencyMs: 1,
          dimensions: {
            requiredSkills: { rawScore: 3, normalizedScore: 75 },
            relevantExperience: { rawScore: 3, normalizedScore: 75 },
            seniority: { rawScore: 3, normalizedScore: 75 },
            domainMatch: { rawScore: 3, normalizedScore: 75 },
            mustHaves: { probability: 0.75 },
          },
        }) };
      }\n`,
    );

    const evaluator = await createCandidateEvaluator(pluginConfig(modulePath));
    await expect(
      evaluator.evaluate({
        job: { id: 'j', description: 'job' },
        candidate: { id: 'c', source: 'custom', resumeText: 'resume' },
      }),
    ).resolves.toEqual({
      model: 'test/model@revision-1',
      candidateId: 'c',
      jobId: 'j',
      compositeScore: 75,
      latencyMs: 1,
      dimensions: {
        requiredSkills: { rawScore: 3, normalizedScore: 75 },
        relevantExperience: { rawScore: 3, normalizedScore: 75 },
        seniority: { rawScore: 3, normalizedScore: 75 },
        domainMatch: { rawScore: 3, normalizedScore: 75 },
        mustHaves: { probability: 0.75 },
      },
    });
  });

  it('does not accept a plugin that silently returns a different model', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'resume-matcher-plugin-'));
    temporaryDirectories.push(directory);
    const modulePath = path.join(directory, 'adapter.mjs');
    await writeFile(
      modulePath,
      `export function createEvaluator() {
        return { evaluate: async (input) => ({
          model: 'different/model',
          candidateId: input.candidate.id,
          jobId: input.job.id,
        }) };
      }\n`,
    );

    const evaluator = await createCandidateEvaluator(pluginConfig(modulePath));
    await expect(
      evaluator.evaluate({
        job: { id: 'j', description: 'job' },
        candidate: { id: 'c', source: 'custom', resumeText: 'resume' },
      }),
    ).rejects.toThrow('expected configured model test/model@revision-1');
  });

  it('rejects invalid plugin scores before they enter rankings or cache', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'resume-matcher-plugin-'));
    temporaryDirectories.push(directory);
    const modulePath = path.join(directory, 'adapter.mjs');
    await writeFile(
      modulePath,
      `export function createEvaluator(config) {
        return { evaluate: async (input) => ({
          model: config.model, candidateId: input.candidate.id, jobId: input.job.id,
          compositeScore: 150, latencyMs: 1,
        }) };
      }\n`,
    );

    const evaluator = await createCandidateEvaluator(pluginConfig(modulePath));
    await expect(
      evaluator.evaluate({
        job: { id: 'j', description: 'job' },
        candidate: { id: 'c', source: 'custom', resumeText: 'resume' },
      }),
    ).rejects.toThrow('compositeScore must be a finite number from 0 to 100');
  });

  it('rejects a module without the evaluator factory export', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'resume-matcher-plugin-'));
    temporaryDirectories.push(directory);
    const modulePath = path.join(directory, 'adapter.mjs');
    await writeFile(modulePath, 'export const unsupported = true;\n');

    await expect(createCandidateEvaluator(pluginConfig(modulePath))).rejects.toThrow(
      'must export createEvaluator(config)',
    );
  });
});
