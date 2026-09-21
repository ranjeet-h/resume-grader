import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { AppConfig } from '../config.js';
import type { CandidateMatchResult, ScoringInput } from '../domain/types.js';
import { LOCAL_LAYA_MODEL_ID, MATCHING_QUESTIONS } from '../scoring/rubric.js';
import {
  type CandidateEvaluator,
  type ModelEvaluationResponse,
  mapTypedAnswersToResult,
  prepareModelInput,
} from './evaluator.js';

interface LayaWorkerReady {
  type: 'ready';
  model: string;
  device: string;
  revision: string;
}

interface LayaWorkerResult {
  type: 'result';
  id: string;
  model: string;
  answers: Record<string, unknown>;
  usage: { input_tokens: number; output_tokens: number; cost: number };
  device: string;
  revision: string;
  truncation: Record<string, unknown>;
  chunking: Record<string, unknown>;
}

interface LayaWorkerRequest {
  state: unknown;
  questions: Record<string, unknown>;
}

interface LayaWorkerClient {
  ready(): Promise<LayaWorkerReady>;
  predict(request: LayaWorkerRequest): Promise<LayaWorkerResult>;
  close(): Promise<void>;
}

class UvLayaWorker implements LayaWorkerClient {
  private readonly child: ChildProcess;
  private readonly lineIterator: AsyncIterator<string>;
  private readonly modelId: string;
  private spawnError?: Error;
  private busy = false;

  constructor(projectDir: string, modelId: string) {
    this.modelId = modelId;
    const workerEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      USE_TF: '0',
    };
    for (const secretName of [
      'OPENAI_API_KEY',
      'OPENROUTER_API_KEY',
      'OPENROUTER_MANAGEMENT_KEY',
      'OPENCODE_API_KEY',
      'OPENCODE_KEY',
      'ANTHROPIC_API_KEY',
    ]) {
      delete workerEnv[secretName];
    }
    this.child = spawn(
      process.env.UV_BIN?.trim() || 'uv',
      [
        'run',
        '--project',
        projectDir,
        '--locked',
        'python',
        path.join(projectDir, 'laya_worker.py'),
      ],
      {
        cwd: projectDir,
        stdio: ['pipe', 'pipe', 'inherit'],
        env: workerEnv,
      },
    );
    this.child.on('error', (error) => {
      this.spawnError = error;
    });
    if (!this.child.stdout || !this.child.stdin) {
      throw new Error('Could not start the local Laya worker with piped stdin/stdout');
    }
    const lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    this.lineIterator = lines[Symbol.asyncIterator]();
  }

  async ready(): Promise<LayaWorkerReady> {
    const message = await this.readMessage();
    if (message['type'] === 'startup_error') {
      throw new Error(
        `Local Laya startup failed (${String(message['error'])}): ${String(message['message'])}`,
      );
    }
    if (
      message['type'] !== 'ready' ||
      message['model'] !== this.modelId ||
      typeof message['device'] !== 'string' ||
      typeof message['revision'] !== 'string'
    ) {
      throw new Error('Local Laya worker returned an invalid startup response');
    }
    return message as unknown as LayaWorkerReady;
  }

  async predict(request: LayaWorkerRequest): Promise<LayaWorkerResult> {
    if (this.busy) throw new Error('Local Laya worker accepts one evaluation at a time');
    this.busy = true;
    try {
      const id = randomUUID();
      this.child.stdin?.write(`${JSON.stringify({ ...request, id })}\n`);
      const message = await this.readMessage();
      if (message['type'] === 'request_error') {
        throw new Error(`Local Laya evaluation failed: ${String(message['message'])}`);
      }
      if (
        message['type'] !== 'result' ||
        message['id'] !== id ||
        message['model'] !== this.modelId ||
        typeof message['answers'] !== 'object' ||
        message['answers'] === null ||
        typeof message['usage'] !== 'object' ||
        message['usage'] === null
      ) {
        throw new Error('Local Laya worker returned an invalid evaluation response');
      }
      return message as unknown as LayaWorkerResult;
    } finally {
      this.busy = false;
    }
  }

  async close(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.stdin?.end();
    await new Promise<void>((resolve) => {
      this.child.once('close', () => resolve());
    });
  }

  private async readMessage(): Promise<Record<string, unknown>> {
    const line = await this.lineIterator.next();
    if (line.done) {
      const cause = this.spawnError ? `: ${this.spawnError.message}` : '';
      throw new Error(`Local Laya worker exited before replying${cause}`);
    }
    let value: unknown;
    try {
      value = JSON.parse(line.value);
    } catch (error) {
      throw new Error('Local Laya worker emitted invalid JSON on stdout', { cause: error });
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('Local Laya worker emitted a non-object response');
    }
    return value as Record<string, unknown>;
  }
}

export async function createLocalLayaEvaluator(config: AppConfig): Promise<CandidateEvaluator> {
  if (config.provider !== 'laya-local' || config.model !== LOCAL_LAYA_MODEL_ID) {
    throw new Error('Local Laya requires the laya-local provider and typed-decisions checkpoint');
  }
  const projectDir = path.join(config.rootDir, 'python');
  const worker = new UvLayaWorker(projectDir, config.model);
  let ready: LayaWorkerReady;
  try {
    ready = await worker.ready();
  } catch (error) {
    await worker.close();
    throw error;
  }

  return {
    async evaluate(input: ScoringInput): Promise<CandidateMatchResult> {
      const startedAt = Date.now();
      const normalized = prepareModelInput(input.job, input.candidate);
      const response = await worker.predict({
        state: {
          job: {
            title: normalized.job.title ?? '',
            description: normalized.job.description,
            seniority: normalized.job.seniority ?? '',
          },
          candidate: { resumeText: normalized.candidate.resumeText },
        },
        questions: MATCHING_QUESTIONS,
      });
      const modelResponse: ModelEvaluationResponse = {
        model: response.model,
        answers: response.answers,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cost: response.usage.cost,
        },
      };
      const result = mapTypedAnswersToResult(modelResponse, normalized, Date.now() - startedAt);
      result.providerMetadata = {
        provider: 'laya-local',
        device: response.device || ready.device,
        modelRevision: response.revision || ready.revision,
        truncation: response.truncation,
        chunking: response.chunking,
      };
      return result;
    },
    close: () => worker.close(),
  };
}
