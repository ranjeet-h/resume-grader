import { createHash } from 'node:crypto';
import { chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { config as loadDotEnv } from 'dotenv';
import { DEFAULT_MODEL_ID } from './scoring/rubric.js';

loadDotEnv({ quiet: true });

export type ScoringProviderId = string;

export interface AppConfig {
  rootDir: string;
  rawDir: string;
  normalizedDir: string;
  outputDir: string;
  cacheDir: string;
  provider: ScoringProviderId;
  model: string;
  adapterModule?: string;
}

export function loadConfig(rootDir = process.cwd()): AppConfig {
  const providerValue = process.env.SCORING_PROVIDER?.trim() || 'laya-local';
  const adapterModule = process.env.SCORING_ADAPTER_MODULE?.trim();
  const customModel = process.env.SCORING_MODEL_ID?.trim();
  if (providerValue !== 'laya-local' && !adapterModule) {
    throw new Error(
      `SCORING_PROVIDER=${providerValue} requires SCORING_ADAPTER_MODULE to point to a trusted local evaluator module`,
    );
  }
  if (providerValue !== 'laya-local' && !customModel) {
    throw new Error(`SCORING_PROVIDER=${providerValue} requires a stable SCORING_MODEL_ID`);
  }
  const model = providerValue === 'laya-local' ? DEFAULT_MODEL_ID : (customModel as string);
  const modelCacheId = createHash('sha256').update(model).digest('hex').slice(0, 16);
  const cacheDir =
    providerValue === 'laya-local'
      ? path.join(rootDir, 'cache', 'laya')
      : path.join(rootDir, 'cache', 'providers', safePathPart(providerValue), modelCacheId);

  const config: AppConfig = {
    rootDir,
    rawDir: path.join(rootDir, 'data', 'raw'),
    normalizedDir: path.join(rootDir, 'data', 'normalized'),
    outputDir: path.join(rootDir, 'output'),
    cacheDir,
    provider: providerValue,
    model,
  };
  if (adapterModule) {
    config.adapterModule = path.resolve(rootDir, adapterModule);
  }
  return config;
}

function safePathPart(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'custom'
  );
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
