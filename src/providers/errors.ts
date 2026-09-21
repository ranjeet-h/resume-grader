import type { PairFailureType } from '../domain/types.js';

export interface ClassifiedError {
  errorType: PairFailureType;
  retryable: boolean;
  message: string;
}

export class ModelResponseParseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ModelResponseParseError';
  }
}

export class RetryExhaustedError extends Error {
  readonly attempts: number;
  readonly originalError: unknown;

  constructor(attempts: number, originalError: unknown) {
    const classified = classifyError(originalError);
    super(`Evaluation failed after ${attempts} attempt(s): ${classified.message}`, {
      cause: originalError,
    });
    this.name = 'RetryExhaustedError';
    this.attempts = attempts;
    this.originalError = originalError;
  }
}

export function classifyError(error: unknown): ClassifiedError {
  const status = readNumericProperty(error, ['statusCode', 'status', 'httpStatus']);
  const name = readStringProperty(error, ['name']);
  const message = error instanceof Error ? error.message : String(error);
  const normalizedMessage = message.toLowerCase();

  if (name === 'ModelResponseParseError') {
    return { errorType: 'parse', retryable: false, message };
  }
  if (name === 'AbortError' || name === 'TimeoutError' || normalizedMessage.includes('timed out')) {
    return { errorType: 'timeout', retryable: true, message };
  }
  if (status === 429 || normalizedMessage.includes('rate limit')) {
    return { errorType: 'rate_limit', retryable: true, message };
  }
  if (status === 401 || status === 403 || normalizedMessage.includes('unauthorized')) {
    return { errorType: 'authentication', retryable: false, message };
  }
  if (status === 400 || status === 422) {
    return { errorType: 'validation', retryable: false, message };
  }
  if (status !== undefined && status >= 500) {
    return { errorType: 'provider', retryable: true, message };
  }
  if (name.toLowerCase().includes('apicall')) {
    return { errorType: 'provider', retryable: false, message };
  }
  return { errorType: 'unknown', retryable: false, message };
}

function readNumericProperty(value: unknown, names: string[]): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  for (const name of names) {
    const property = (value as Record<string, unknown>)[name];
    if (typeof property === 'number' && Number.isFinite(property)) return property;
  }
  return undefined;
}

function readStringProperty(value: unknown, names: string[]): string {
  if (typeof value !== 'object' || value === null) return '';
  for (const name of names) {
    const property = (value as Record<string, unknown>)[name];
    if (typeof property === 'string') return property;
  }
  return '';
}
