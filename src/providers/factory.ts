import { pathToFileURL } from 'node:url';
import type { AppConfig } from '../config.js';
import type { CandidateMatchResult, ScoringInput } from '../domain/types.js';
import type { CandidateEvaluator } from './evaluator.js';
import { createLocalLayaEvaluator } from './laya-local.js';

export interface EvaluatorPlugin {
  createEvaluator(config: AppConfig): Promise<CandidateEvaluator> | CandidateEvaluator;
}

/** Load the explicitly selected evaluator. There is intentionally no provider fallback. */
export async function createCandidateEvaluator(config: AppConfig): Promise<CandidateEvaluator> {
  if (config.provider === 'laya-local') return createLocalLayaEvaluator(config);
  if (!config.adapterModule) {
    throw new Error(`No evaluator module is configured for provider ${config.provider}`);
  }

  let plugin: Partial<EvaluatorPlugin>;
  try {
    plugin = (await import(pathToFileURL(config.adapterModule).href)) as Partial<EvaluatorPlugin>;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'module import failed';
    throw new Error(`Could not load evaluator module ${config.adapterModule}: ${reason}`, {
      cause: error,
    });
  }
  if (typeof plugin.createEvaluator !== 'function') {
    throw new Error('Evaluator module must export createEvaluator(config)');
  }

  const evaluator = await plugin.createEvaluator(config);
  if (!evaluator || typeof evaluator.evaluate !== 'function') {
    throw new Error('createEvaluator(config) must return an object with evaluate(input)');
  }
  return enforceModelIdentity(evaluator, config.model);
}

function enforceModelIdentity(
  evaluator: CandidateEvaluator,
  expectedModel: string,
): CandidateEvaluator {
  return {
    async evaluate(input: ScoringInput): Promise<CandidateMatchResult> {
      const result = await evaluator.evaluate(input);
      validatePluginResult(result, input, expectedModel);
      return result;
    },
    ...(evaluator.close ? { close: () => evaluator.close?.() ?? Promise.resolve() } : {}),
  };
}

function validatePluginResult(
  result: CandidateMatchResult,
  input: ScoringInput,
  expectedModel: string,
): void {
  if (!result || typeof result !== 'object') {
    throw new Error('Evaluator must return a CandidateMatchResult object');
  }
  if (result.model !== expectedModel) {
    throw new Error(
      `Evaluator returned model ${result.model}; expected configured model ${expectedModel}`,
    );
  }
  if (result.candidateId !== input.candidate.id || result.jobId !== input.job.id) {
    throw new Error('Evaluator result candidateId and jobId must match the input pair');
  }
  if (!isFiniteRange(result.compositeScore, 0, 100)) {
    throw new Error('Evaluator compositeScore must be a finite number from 0 to 100');
  }
  if (!isFiniteRange(result.latencyMs, 0, Number.MAX_SAFE_INTEGER)) {
    throw new Error('Evaluator latencyMs must be a non-negative finite number');
  }
  for (const dimension of [
    result.dimensions?.requiredSkills,
    result.dimensions?.relevantExperience,
    result.dimensions?.seniority,
    result.dimensions?.domainMatch,
  ]) {
    if (
      !dimension ||
      !isFiniteRange(dimension.rawScore, 0, 4) ||
      !isFiniteRange(dimension.normalizedScore, 0, 100)
    ) {
      throw new Error(
        'Evaluator score dimensions must contain raw scores 0..4 and normalized scores 0..100',
      );
    }
  }
  if (!isFiniteRange(result.dimensions?.mustHaves?.probability, 0, 1)) {
    throw new Error('Evaluator mustHaves probability must be a finite number from 0 to 1');
  }
  for (const tokens of [result.usage?.inputTokens, result.usage?.outputTokens]) {
    if (tokens !== undefined && (!Number.isInteger(tokens) || tokens < 0)) {
      throw new Error('Evaluator token usage must use non-negative integer counts');
    }
  }
  const cost = result.usage?.costUsd;
  if (cost !== undefined && !isFiniteRange(cost, 0, Number.MAX_SAFE_INTEGER)) {
    throw new Error('Evaluator costUsd must be a non-negative finite number');
  }
}

function isFiniteRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}
