---
layout: docs
title: Provider architecture
description: Add or replace an evaluator without changing the dataset, ranking, and report pipeline.
permalink: /docs/providers/
---

## Evaluator interface

The batch pipeline depends on the `CandidateEvaluator` interface in `src/providers/evaluator.ts`. An evaluator accepts a validated job/resume pair and returns a `CandidateMatchResult`; the pipeline handles caching, ordering, progress, failure records, metrics, and reports.

The current adapter is `src/providers/laya-local.ts`. It starts one Python worker for a CLI run and communicates over JSON Lines. The worker loads the pinned typed-decisions checkpoint once, scores one pair at a time, and closes when the run finishes. Apple Silicon uses PyTorch MPS when available; other machines use CPU. The exact checkpoint commit is embedded in the model identifier and cache key.

## Select a different local model

The CLI can load a trusted local ESM adapter module without edits to the dataset, ranking, cache, or report pipeline. Adapters can run MLX, ONNX Runtime, llama.cpp, Transformers, or another local backend. The adapter is responsible for translating that model's output into the stable result contract.

1. Build the internal helper modules once: `pnpm build`.
2. Copy [`examples/evaluator-plugin.mjs`](../examples/evaluator-plugin.mjs) and connect its `loadLocalBackend` function to your local runtime.
3. Configure the provider, a stable versioned model ID, and the adapter path in an untracked `.env` file:

   ```dotenv
   SCORING_PROVIDER=my-local-model
   SCORING_MODEL_ID=publisher/model@revision-or-quantization
   SCORING_ADAPTER_MODULE=./examples/my-model-adapter.mjs
   ```

4. Run a `match --dry-run`, then a small sample. A plugin is loaded only when a scoring run starts; dry runs never import or execute it.
5. Confirm the output's model ID, token counts, device/revision metadata, and ranking before using it for an experiment.

The module must export `createEvaluator(config)`. It returns an object implementing `evaluate(input)` and may implement `close()`. `input` contains the normalized, contact-redacted job and resume. `evaluate` returns a `CandidateMatchResult` with the configured model ID, rubric dimensions, composite score, latency, and actual token usage when the backend exposes it. See the example for the required typed-answer mapping and local-backend seam.

Custom adapters run as code with your OS user's permissions. Review each adapter before configuring it; a plugin may access files, start subprocesses, or use the network. Keep personal resume data and reports local. This repository provides no automatic provider selection or fallback. If the selected adapter fails, the run stops.

The built-in provider runs locally and reports zero inference cost. A custom adapter must report its real usage and cost; zero is only appropriate when inference is local and free to run. The 500+ evaluation preflight checks the values the adapter reports, but cannot audit a custom adapter's implementation or enforce that it stayed offline.

## Reproducibility

The built-in model repository commit is pinned in `python/laya_worker.py`; run manifests record the resolved revision and device. Cache keys include the model ID, rubric version, normalized job, and normalized resume. For a custom adapter, include the model revision and quantization in `SCORING_MODEL_ID` so changing weights cannot reuse old results. Bump the rubric version when changing questions or criteria and the scoring config version when changing weights.
