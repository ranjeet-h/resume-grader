import { classifyError, RetryExhaustedError } from './errors.js';

export interface RetryOptions {
  maxRetries: number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  onRetry?: (event: { retry: number; delayMs: number; error: unknown }) => void;
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep = options.sleep ?? delay;
  const random = options.random ?? Math.random;
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      const classification = classifyError(error);
      if (!classification.retryable || attempt >= options.maxRetries) {
        throw new RetryExhaustedError(attempt + 1, error);
      }
      const delayMs = calculateBackoffDelay(attempt, random);
      options.onRetry?.({ retry: attempt + 1, delayMs, error });
      await sleep(delayMs);
      attempt += 1;
    }
  }
}

export function calculateBackoffDelay(retryIndex: number, random = Math.random): number {
  if (!Number.isInteger(retryIndex) || retryIndex < 0) {
    throw new RangeError('retryIndex must be a nonnegative integer');
  }
  const base = Math.min(500 * 2 ** retryIndex, 8_000);
  const jitterFactor = 0.8 + random() * 0.4;
  return Math.round(base * jitterFactor);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
