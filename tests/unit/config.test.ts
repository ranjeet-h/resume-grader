import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AppConfig, ensureOutputDirectories, loadConfig } from '../../src/config.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('evaluator configuration', () => {
  it('uses the pinned Laya model by default', () => {
    vi.stubEnv('SCORING_PROVIDER', '');
    vi.stubEnv('SCORING_ADAPTER_MODULE', '');
    vi.stubEnv('SCORING_MODEL_ID', '');

    const config = loadConfig('/tmp/resume-matcher-config');

    expect(config.provider).toBe('laya-local');
    expect(config.model).toContain('convaiinnovations/laya:typed-decisions@');
    expect(config.cacheDir).toBe('/tmp/resume-matcher-config/cache/laya');
  });

  it('requires a module and stable model identity for an alternate provider', () => {
    vi.stubEnv('SCORING_PROVIDER', 'mlx-local');
    vi.stubEnv('SCORING_ADAPTER_MODULE', '');
    vi.stubEnv('SCORING_MODEL_ID', 'publisher/model@revision');
    expect(() => loadConfig('/tmp/resume-matcher-config')).toThrow(
      'requires SCORING_ADAPTER_MODULE',
    );

    vi.stubEnv('SCORING_ADAPTER_MODULE', './adapters/mlx.mjs');
    vi.stubEnv('SCORING_MODEL_ID', '');
    expect(() => loadConfig('/tmp/resume-matcher-config')).toThrow(
      'requires a stable SCORING_MODEL_ID',
    );
  });

  it('isolates alternate model caches by provider and model identity', () => {
    vi.stubEnv('SCORING_PROVIDER', 'mlx local');
    vi.stubEnv('SCORING_ADAPTER_MODULE', './adapters/mlx.mjs');
    vi.stubEnv('SCORING_MODEL_ID', 'publisher/model@revision-1');

    const first = loadConfig('/tmp/resume-matcher-config');
    vi.stubEnv('SCORING_MODEL_ID', 'publisher/model@revision-2');
    const second = loadConfig('/tmp/resume-matcher-config');

    expect(first.adapterModule).toBe('/tmp/resume-matcher-config/adapters/mlx.mjs');
    expect(first.cacheDir).toContain('/cache/providers/mlx-local/');
    expect(first.cacheDir).not.toBe(second.cacheDir);
  });
});

describe('local data directory permissions', () => {
  it('creates owner-only cache, output, and normalized directories on Unix', async () => {
    if (process.platform === 'win32') return;
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'resume-matcher-permissions-'));
    temporaryDirectories.push(rootDir);
    const config: AppConfig = {
      rootDir,
      rawDir: path.join(rootDir, 'data', 'raw'),
      normalizedDir: path.join(rootDir, 'data', 'normalized'),
      outputDir: path.join(rootDir, 'output'),
      cacheDir: path.join(rootDir, 'cache', 'laya'),
      provider: 'laya-local',
      model: 'local-model',
    };

    await ensureOutputDirectories(config);
    for (const directory of [config.normalizedDir, config.outputDir, config.cacheDir]) {
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
    }
  });
});
