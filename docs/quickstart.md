---
layout: docs
title: Quick start
description: Run a local match with your own job description and PDF or plain-text resumes.
permalink: /docs/quickstart/
---

## What this runs

The CLI evaluates each resume against one job using the pinned `convaiinnovations/laya:typed-decisions` checkpoint. TypeScript computes a weighted 0–100 rubric score from four typed dimensions and a must-have probability. The score is **not** a match probability. All inference runs on the local machine; the first model run downloads weights from Hugging Face.

This is an experimental research tool. Do not use its rankings to make or automate hiring decisions. See [privacy and safe use](privacy-and-safety.md) before supplying candidate data.

## Requirements

- macOS on Apple Silicon is the fastest supported path; PyTorch MPS is selected when available.
- Python 3.12, managed by [`uv`](https://docs.astral.sh/uv/).
- Node.js 22 or newer and `pnpm` 10.
- Several GB of free disk space for the Python environment and model cache. The checkpoint is downloaded on first inference.
- On machines without Apple MPS, inference uses CPU and can be much slower.

From the repository root:

```bash
pnpm install --frozen-lockfile
uv sync --project python --locked
```

The model is public. Hugging Face authentication is optional unless Hub rate limits require an account token. If needed, use `hf auth login` or set `HF_TOKEN` in a local, untracked `.env` file. Never commit that file.

## Prepare one job description

Create a UTF-8 JSON file with a non-empty `id` and `description`. Other fields are optional.

```json
{
  "id": "backend-engineer-01",
  "title": "Backend Engineer",
  "location": "Remote",
  "seniority": "Mid-level",
  "description": "Build and operate backend services. Required skills: TypeScript, Node.js, REST APIs, PostgreSQL, automated testing, and production debugging."
}
```

The schema is defined in `src/domain/types.ts`. Keep the description focused on job-related requirements. Do not add age, health, family, religion, race, or other protected-trait criteria.

## Prepare resumes

Put `.pdf` or UTF-8 `.txt` files in one directory. Subdirectories are allowed. The command uses embedded PDF text only; scanned documents are rejected before any model calls because OCR is not implemented. Each readable file must contain at least 80 characters and be no larger than 25 MiB. The full directory must be at most 512 MiB. Unsupported files stop the run rather than being silently skipped.

Use neutral filenames such as `applicant-001.pdf`. The CLI creates anonymous IDs such as `candidate-0001`; a private local map connects IDs to source filenames.

## Inspect inputs, then match

Start with a dry run. It extracts and validates files but **does not load the model or make model calls**:

```bash
pnpm exec tsx src/cli.ts match \
  --job ./examples/job.json \
  --resumes /absolute/path/to/resumes \
  --dry-run
```

If the inputs look right, score every discovered resume:

```bash
pnpm exec tsx src/cli.ts match \
  --job ./examples/job.json \
  --resumes /absolute/path/to/resumes
```

To select a reproducible sample first, add `--limit 10 --seed 42`. The full set is used when `--limit` is omitted. The result cache is enabled by default; add `--no-cache` to force local reevaluation on runs below 500 resumes. For 500 or more resumes, the CLI requires its ten uncached local preflight and blocks `--no-cache`; only after ten successful evaluations report complete token usage and zero provider-reported cost will the full local run proceed. There is no hosted inference provider or paid-model fallback.

## Read the output

The command prints paths under `output/`:

- `output/rankings/<run-id>/all.csv` — complete, ranked dimension scores.
- `output/rankings/<run-id>/top-20.md` — readable top 20.
- `output/rankings/<run-id>/all.json` — complete structured output.
- `output/rankings/<run-id>/input-files.private.json` — local source-file map. It may contain sensitive filenames; do not share it.
- `output/reports/<run-id>/report.md` and `report.json` — run configuration, runtime, metrics, and caveats.

Exports include scores and anonymous IDs, not extracted resume text. A human must open and review the source resume for every candidate under consideration. The score does not explain which exact resume lines drove a dimension.

## Reproduce evaluation examples

```bash
pnpm exec tsx src/cli.ts laya:smoke --count 10
pnpm exec tsx src/cli.ts benchmark:gold --limit 106 --seed 42
git clone --depth 1 https://github.com/NataliaVanetik/vacancy-resume-matching-dataset.git data/raw/vanetik-vacancy-resume
pnpm data:vanetik
pnpm exec tsx src/cli.ts benchmark:vanetik
```

See [benchmark methodology](benchmark-methodology.md) for dataset setup and how to interpret those results. Public dataset terms remain with their original sources; see [model and data licenses](model-and-data-licenses.md).

For the Role Radar gold-pair benchmark, download the seven JSON files named in `src/datasets/role-radar.ts` from the [Role Radar dataset repository](https://huggingface.co/datasets/oksomu/role-radar-dataset) into `data/raw/role-radar/`, then run `pnpm data:role-radar` before `pnpm benchmark:gold --limit 106 --seed 42`. The source currently identifies an Apache-2.0 license; recheck its card before use.
