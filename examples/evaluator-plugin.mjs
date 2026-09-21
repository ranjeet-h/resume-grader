// Adapter template for a future local MLX, ONNX Runtime, llama.cpp, or other model.
// Build the project first (`pnpm build`) so the stable mapping helpers exist in dist/.
import {
  mapTypedAnswersToResult,
  prepareModelInput,
} from '../dist/providers/evaluator.js';
import { MATCHING_QUESTIONS } from '../dist/scoring/rubric.js';

export async function createEvaluator(config) {
  const backend = await loadLocalBackend(config);

  return {
    async evaluate(input) {
      const startedAt = Date.now();
      const normalized = prepareModelInput(input.job, input.candidate);
      const response = await backend.evaluate({
        model: config.model,
        job: normalized.job,
        candidate: normalized.candidate,
        questions: MATCHING_QUESTIONS,
      });

      if (
        !Number.isFinite(response?.usage?.inputTokens) ||
        !Number.isFinite(response?.usage?.outputTokens)
      ) {
        throw new Error('The local backend must return actual input and output token counts');
      }

      const result = mapTypedAnswersToResult(
        {
          model: config.model,
          answers: response.answers,
          usage: {
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            cost: 0,
          },
        },
        normalized,
        Date.now() - startedAt,
      );
      result.providerMetadata = {
        provider: config.provider,
        ...(response.device ? { device: response.device } : {}),
        ...(response.revision ? { modelRevision: response.revision } : {}),
        ...(response.metadata ?? {}),
      };
      return result;
    },
    async close() {
      await backend.close?.();
    },
  };
}

async function loadLocalBackend(config) {
  // Replace this function with the chosen local runtime and pinned model loader.
  // Do not add a paid or remote fallback. Throw if the model cannot be loaded.
  throw new Error(`Connect a local inference runtime for ${config.model}`);
}
