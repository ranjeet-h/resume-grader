# Contributing

Thanks for helping improve the local matching research toolkit.

## Before opening a change

- Read the [benchmark methodology](docs/benchmark-methodology.md), [privacy guidance](docs/privacy-and-safety.md), and [license notes](docs/model-and-data-licenses.md).
- Use synthetic or public, properly licensed fixtures. Never add real candidate resumes, personal data, private benchmark labels, API keys, caches, or generated run outputs.
- Keep provider-specific behavior behind `CandidateEvaluator` and preserve the no-automatic-fallback behavior.
- Do not frame experimental rubric scores as hiring predictions or match probabilities.

## Development setup

```bash
pnpm install --frozen-lockfile
uv sync --project python --locked
```

The model download is only needed to run local inference. Unit tests use injected evaluators and do not require the checkpoint.

## Before submitting

Run these checks from the repository root:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Review `git status --short`, `git diff --check`, and every staged file. Verify that `data/raw/`, `data/normalized/`, `cache/`, `output/`, `.env`, and any private input map are absent from the change.

For changes to scoring, include the rubric/config version impact and a benchmark comparison. Do not run or publish a large model benchmark without clear data provenance and an explicit evaluation plan.
