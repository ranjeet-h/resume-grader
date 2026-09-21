import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type AppConfig, ensureOutputDirectories } from '../../src/config.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
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
