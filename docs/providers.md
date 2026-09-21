---
layout: docs
title: Provider architecture
description: Add or replace an evaluator without changing the dataset, ranking, and report pipeline.
permalink: /docs/providers/
---

## Evaluator interface

The batch pipeline depends on the `CandidateEvaluator` interface in `src/providers/evaluator.ts`. An evaluator accepts a validated job/resume pair and returns a `CandidateMatchResult`; the pipeline handles caching, ordering, progress, failure records, metrics, and reports.

The current adapter is `src/providers/laya-local.ts`. It starts one Python worker for a CLI run and communicates over JSON Lines. The worker loads the pinned typed-decisions checkpoint once, scores one pair at a time, and closes when the run finishes. Apple Silicon uses PyTorch MPS when available; other machines use CPU. The exact checkpoint commit is embedded in the model identifier and cache key.

## Replacing the evaluator

1. Implement `CandidateEvaluator` with typed usage, latency, provider metadata, and clear errors.
2. Keep provider-specific setup and credentials inside the adapter; do not put them in dataset or ranking code.
3. Add a configuration value and factory selection in `src/config.ts` and `src/cli.ts`.
4. Add tests for valid output, invalid typed answers, failure classification, and provider cleanup.
5. Preserve the no-fallback rule: the CLI must stop when the selected provider fails, and must never choose a different paid model automatically.
6. Update privacy/network documentation before adding any remote inference adapter.

The current build intentionally does not configure a remote provider. Local cost is reported as zero because no inference charge is incurred; this is local accounting, not a hosted price quote.

## Reproducibility

The model repository commit is pinned in `python/laya_worker.py`; run manifests record the resolved revision and device. Cache keys include the model ID, rubric version, normalized job, and normalized resume. Bump the model ID when changing checkpoint weights so old cache records cannot be reused accidentally. Bump the rubric version when changing questions or criteria and the scoring config version when changing weights.
