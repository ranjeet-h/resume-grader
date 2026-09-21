import { chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { config as loadDotEnv } from 'dotenv';
import { DEFAULT_MODEL_ID } from './scoring/rubric.js';

loadDotEnv({ quiet: true });

export type ScoringProviderId = 'laya-local';

export interface AppConfig {
  rootDir: string;
  rawDir: string;
  normalizedDir: string;
  outputDir: string;
  cacheDir: string;
  provider: ScoringProviderId;
  model: string;
}

export function loadConfig(rootDir = process.cwd()): AppConfig {
  const providerValue = process.env.SCORING_PROVIDER?.trim() || 'laya-local';
  if (providerValue !== 'laya-local') {
    throw new Error(
      `Unsupported SCORING_PROVIDER=${providerValue}; this build supports laya-local only`,
    );
  }

  return {
    rootDir,
    rawDir: path.join(rootDir, 'data', 'raw'),
    normalizedDir: path.join(rootDir, 'data', 'normalized'),
    outputDir: path.join(rootDir, 'output'),
    cacheDir: path.join(rootDir, 'cache', 'laya'),
    provider: 'laya-local',
    model: DEFAULT_MODEL_ID,
  };
}

export async function ensureOutputDirectories(config: AppConfig): Promise<void> {
  const directories = [config.normalizedDir, config.outputDir, config.cacheDir];
  await Promise.all(
    directories.map(async (directory) => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      if (process.platform !== 'win32') await chmod(directory, 0o700);
    }),
  );
}
