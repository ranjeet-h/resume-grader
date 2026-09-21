# Local Resume Matcher

**A local-first research toolkit for testing resume-to-job matching.** Run a small typed-decision model on your machine, compare its rankings with labels and a lexical baseline, and inspect where the method still needs work.

> **Research software, not a hiring decision system.** Current scores are experimental rubric scores, not calibrated probabilities or recommendations. Do not use them to select, reject, or rank real candidates for employment decisions.

[Project site](https://ranjeet-h.github.io/resume-grader/) · [Documentation](docs/index.md) · [Quick start](docs/quickstart.md) · [Benchmark methodology](docs/benchmark-methodology.md) · [Privacy and safe use](docs/privacy-and-safety.md)

## What it does

- Runs Convai Innovations' `convaiinnovations/laya:typed-decisions` locally through a replaceable TypeScript `CandidateEvaluator` and a Python worker managed by `uv`.
- Lets users plug in a trusted local model adapter through `SCORING_ADAPTER_MODULE`; MLX, ONNX Runtime, and other model backends can share the same ranking and report pipeline.
- Uses PyTorch MPS on Apple Silicon when available and falls back to CPU on other machines.
- Accepts local PDF and UTF-8 TXT files for one job description through `match`.
- Parses PDF text locally, chunks long resumes to fit the model context, and exports anonymous candidate IDs, ranked scores, runtime metadata, and reports.
- Provides benchmark adapters, human-label comparisons where available, a BM25 baseline, and a 10-call zero-cost local preflight for large runs.

No hosted inference provider is configured. The first inference downloads the pinned model checkpoint from Hugging Face. Resume text and job descriptions are not sent to a hosted inference API. See [privacy and safe use](docs/privacy-and-safety.md) for local storage behavior and redaction limits.

## Quick start

Requirements: Node.js 22+, pnpm 10, Python 3.12, and [`uv`](https://docs.astral.sh/uv/). Apple Silicon is preferred for MPS; CPU inference is supported but slower.

```bash
pnpm install --frozen-lockfile
uv sync --project python --locked
```

Prepare a folder of `.pdf` or `.txt` resumes and a job JSON file, then validate inputs without loading the model:

```bash
pnpm exec tsx src/cli.ts match \
  --job ./examples/job.json \
  --resumes /absolute/path/to/resumes \
  --dry-run
```

Run the match after reviewing the dry-run summary:

```bash
pnpm exec tsx src/cli.ts match \
  --job ./examples/job.json \
  --resumes /absolute/path/to/resumes
```

The command evaluates all discovered resumes by default. Add `--limit 10 --seed 42` for a reproducible sample. See the [quick-start guide](docs/quickstart.md) for input rules, output files, model download behavior, and benchmark commands.

## Current evidence

The local run on the Vanetik/Kogan sample scored 30 resumes against five vacancies. Against mean human vacancy ranks, Laya reached 53.2% pairwise agreement; BM25 reached 58.2%. This dataset ranks vacancies for each resume, rather than candidates for one job, so it does not validate the intended candidate-ranking workflow. The observed results show no consistent Laya advantage over the baseline.

The [benchmark methodology](docs/benchmark-methodology.md) explains label provenance and the additional same-job evaluation needed before any quality claim. Scores are not match percentages.

## Local outputs

Run caches, benchmark source data, normalized candidate text, reports, rankings, and local filename maps are excluded by `.gitignore`. Still check `git status` before publishing: ignore rules are not a substitute for reviewing staged files. The resume-to-filename map is private and must not be shared.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
```

These checks do not download model weights or validate matching quality. The local smoke check exercises actual inference:

```bash
pnpm exec tsx src/cli.ts laya:smoke --count 10
```

## Project docs

- [Documentation hub](docs/index.md)
- [Quick start and custom matching](docs/quickstart.md)
- [Privacy and safe use](docs/privacy-and-safety.md)
- [Benchmark methodology](docs/benchmark-methodology.md)
- [Provider architecture](docs/providers.md)
- [Custom local model adapter template](examples/evaluator-plugin.mjs)
- [Model and data licenses](docs/model-and-data-licenses.md)
- [Implementation and historical results](IMPLEMENTATION.md)
- [Original PoC plan](laya-resume-matching-poc-implementation.md)

## License

Original repository code and documentation are under the MIT License. Model weights, dependencies, and optional datasets keep their own licenses; see [Model and data licenses](docs/model-and-data-licenses.md).
