import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CandidateMatchResult } from '../domain/types.js';
import { DEFAULT_MODEL_ID } from '../scoring/rubric.js';

export const REQUIRED_MODEL_PREFLIGHT_SIZE = 10;

export interface ModelPreflightProjection {
  sampleCount: number;
  targetCount: number;
  observedInputTokens: number;
  observedOutputTokens: number;
  observedTotalTokens: number;
  observedCostUsd: number;
  averageInputTokens: number;
  averageOutputTokens: number;
  projectedFullCostUsd: 0;
  projectedRemainingCostUsd: 0;
}

export function projectModelPreflight(
  results: readonly CandidateMatchResult[],
  targetCount: number,
  expectedModel = DEFAULT_MODEL_ID,
): ModelPreflightProjection {
  if (results.length !== REQUIRED_MODEL_PREFLIGHT_SIZE) {
    throw new Error(`Expected ${REQUIRED_MODEL_PREFLIGHT_SIZE} successful local-model evaluations`);
  }
  if (!Number.isInteger(targetCount) || targetCount < REQUIRED_MODEL_PREFLIGHT_SIZE) {
    throw new RangeError('targetCount must be at least ten');
  }
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  for (const [index, result] of results.entries()) {
    if (result.model !== expectedModel) {
      throw new Error(`Evaluation ${index + 1} did not use ${expectedModel}`);
    }
    const usage = result.usage;
    if (
      usage?.inputTokens === undefined ||
      !Number.isInteger(usage.inputTokens) ||
      usage.inputTokens < 0 ||
      usage.outputTokens === undefined ||
      !Number.isInteger(usage.outputTokens) ||
      usage.outputTokens < 0 ||
      usage.costUsd === undefined ||
      !Number.isFinite(usage.costUsd) ||
      usage.costUsd !== 0
    ) {
      throw new Error(
        `Evaluation ${index + 1} lacks complete token usage or reports nonzero local cost`,
      );
    }
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    costUsd += usage.costUsd;
  }
  return {
    sampleCount: results.length,
    targetCount,
    observedInputTokens: inputTokens,
    observedOutputTokens: outputTokens,
    observedTotalTokens: inputTokens + outputTokens,
    observedCostUsd: costUsd,
    averageInputTokens: inputTokens / results.length,
    averageOutputTokens: outputTokens / results.length,
    projectedFullCostUsd: 0,
    projectedRemainingCostUsd: 0,
  };
}

export async function writeModelPreflightReport(input: {
  outputDir: string;
  provider: string;
  model: string;
  dataset: string;
  targetCount: number;
  results: readonly CandidateMatchResult[];
  failures: ReadonlyArray<{ candidateId: string; errorType: string; message: string }>;
  projection?: ModelPreflightProjection;
  reason?: string;
}): Promise<string> {
  const checkedAt = new Date().toISOString();
  const directory = path.join(input.outputDir, 'preflight');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const reportPath = path.join(
    directory,
    `model-${input.targetCount}-${checkedAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.json`,
  );
  const usage = input.results.map((result) => ({
    candidateId: result.candidateId,
    model: result.model,
    inputTokens: result.usage?.inputTokens ?? null,
    outputTokens: result.usage?.outputTokens ?? null,
    costUsd: result.usage?.costUsd ?? null,
  }));
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        provider: input.provider,
        model: input.model,
        dataset: input.dataset,
        targetCount: input.targetCount,
        requiredSampleCount: REQUIRED_MODEL_PREFLIGHT_SIZE,
        sampleCountSuccessful: input.results.length,
        usage,
        projection: input.projection ?? null,
        failures: input.failures,
        sufficient: input.results.length === REQUIRED_MODEL_PREFLIGHT_SIZE && !input.reason,
        reason: input.reason ?? null,
        checkedAt,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  return reportPath;
}
