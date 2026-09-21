# Laya Resume Matcher: Plan and Results

## Current decision

Use the `convaiinnovations/laya:typed-decisions` checkpoint locally through the Laya Python package and PyTorch. The exact Hub revision is pinned to `1c5edc17a7acd8701df6fc341c0d179f1c62c982`; Apple Silicon uses MPS when available and other systems fall back to CPU. The TypeScript scoring provider remains replaceable, while this PoC configures only the local Laya implementation. Resume text is not sent to a hosted model.

The 421M-parameter checkpoint has a 1,024-token total context. Its question/prompt allocation leaves about 728 tokens for the combined job and resume state. The worker now divides longer, redacted resume text into overlapping token windows, includes the job in each window, and averages each dimension's probability distribution by its non-overlapping token coverage. It records window offsets and coverage. This uses more local passes and is an experimental score aggregation that still needs labeled validation.

## Model variants

| Checkpoint | Parameters | Published context | Notes |
| --- | ---: | ---: | --- |
| `convaiinnovations/laya` | 421M | 512 | General English base |
| `convaiinnovations/laya-multilingual` | 322M | 1,024 | Multilingual base; not the selected English scorer |
| `convaiinnovations/laya:typed-decisions` | 421M | 1,024 | Selected to produce typed scores and probabilities |

The model author's 0.766 accuracy result is from four unrelated typed-decision workflows. It does not establish resume-matching accuracy. The model card describes the checkpoint as a specialist for those workflows and cautions about using it outside them. The resume/JD results here reinforce that quality must be evaluated independently.

## Runtime and provider contract

- Python 3.12 and dependencies are pinned with `uv`.
- A JSON Lines worker loads the checkpoint once per CLI run and uses MPS on Apple Silicon where available.
- The local worker scrubs hosted-provider API keys from its child environment.
- The generic `CandidateEvaluator` provider interface keeps the implementation replaceable.
- The model input removes contact details, normalizes job/resume text, records token use and truncation, and writes local results and reports.
- Local inference reports zero provider cost. That is a local accounting convention, not a hosted usage price.
- Result cache keys include the configured model identifier.

## Implemented features

| Area | Status |
| --- | --- |
| Resume/JD normalization, contact redaction, typed score mapping and deterministic composite | Implemented |
| Replaceable provider contract with local-only Laya configuration | Implemented |
| `uv` Python worker, checkpoint loading and MPS device reporting | Implemented and exercised |
| Token accounting and per-result truncation metadata | Implemented |
| Synthetic local smoke, human-labeled benchmark, dataset adapters and reports | Implemented |
| PDF text extraction and a ten-resume sample command | Implemented and exercised |
| Full-resume multi-window inference and per-dimension probability aggregation | Implemented and exercised on ten PDFs; quality not yet calibrated |

## Data and job description

The PDF sample uses ten individual PDF examples from Kaggle's Resume Dataset: five categorized as Information Technology and five as Accountant. The current Kaggle metadata identifies the dataset as CC0 and describes the resumes as examples sourced from a public resume-example site. The files are under `data/raw/kaggle-resumes/data/`; raw candidate data is excluded from Git.

The job fixture `data/fixtures/synechron-fullstack-job.json` paraphrases Synechron posting JR1043415 for a Bengaluru Full-Stack Developer. It includes Node.js, React, TypeScript, REST APIs, SQL/NoSQL stores, CI/CD, tests, production debugging, and AI-assisted development. It is a paraphrase for the PoC, not an official copy of the posting.

Run the sample with:

```bash
pnpm exec tsx src/cli.ts benchmark:pdf-sample --limit 10 --seed 42 --no-cache
```

The command rejects limits above ten, extracts PDF text locally, scores required skills, relevant experience, seniority, domain fit, and must-have coverage, and writes JSON and Markdown reports. It does not use category labels as match truth.

## Results from 2026-09-21

### Local model smoke

The ten synthetic checks completed on MPS: 10/10 succeeded, 9,910 input tokens, zero output tokens, and zero reported local provider cost. Mean latency was 552 ms. This verifies loading and execution only.

### 106 human-reviewed Role Radar pairs

Latest corrected run: `2026-09-21T04-29-51-713Z-db3a800f`.

- All 106 resolved pairs completed locally on MPS with zero failures, retries, output tokens, or provider-reported cost. Runtime was 170.7 seconds and input usage was 357,736 tokens.
- All 6,491 resume tokens were covered across 106 windows. The longest state used 716 of the 728-token budget. Long JDs were compacted only when required to reserve resume context; 51 of 106 were compacted.
- Against the Role Radar labels, Laya's composite MAE was 8.86 points and Spearman correlation was 0.282. Skills Spearman was 0.376, seniority -0.092, and domain 0.008. This is weak agreement, especially for seniority and domain.
- The set spans 84 postings: 72 have one labeled candidate, 12 have multiple, and the largest group has six. Pairwise accuracy over those 12 rankable groups was 0.673 for Laya and 0.591 for BM25. There are no meaningful top-10 metrics because no group has more than six labels.
- Gold composites range from 58–96: 33 are 50–69, 61 are 70–89, and 12 are 90–96; none are below 50. This set cannot validate low-match bands or 25 candidates against one JD.
- Role Radar's composite includes a location label, while the Laya composite does not. Composite error is therefore not a like-for-like rubric comparison. The results measure agreement with these labels, not hiring outcomes.

See `output/reports/2026-09-21T04-29-51-713Z-db3a800f/report.md` for pair-level disagreements and complete metrics. An earlier pass was superseded after correcting JD state allocation and excluding singleton postings from ranking metrics.

### Public Vanetik/Kogan human-ranking dataset

The source repository contains 65 anonymized resume documents, five software vacancies, and two human ranking arrays for the first 30 resumes. The human task orders the five vacancies for each resume; it is not the exact employer workflow of ranking candidates for one vacancy. The repository declares GPL-3.0 and is retained under `data/raw/vanetik-vacancy-resume/`.

Latest local run: `2026-09-21T05-20-09-758Z-8fd57be1`.

- 150/150 resume-vacancy evaluations succeeded on local MPS in 548.9 seconds; 1,187,100 input tokens, zero output tokens, and zero provider-reported cost.
- Human annotators agreed on pairwise vacancy order 56.3% of the time. Two rows from annotator 1 repeat rank positions; the benchmark keeps those as ties and awards half credit on tied comparisons.
- Laya pairwise agreement averaged 54.0% against the two annotators; BM25 averaged 59.0%. Mean Spearman was 0.093 for Laya and 0.209 for BM25. Laya does not show a reliable advantage over the lexical baseline on this small, noisy set.
- Laya's 0–100 composite is a rubric score, not a calibrated probability. Its mean was 68.94 (range 66.56–74.30).
- The report includes Laya's best-vacancy choice for every resume. The companion CSV ranks all 30 resumes under each of the five vacancies; those per-vacancy candidate rankings are exploratory because the source labels do not directly rank candidates for a fixed JD.

Commands:

```bash
pnpm data:vanetik
pnpm exec tsx src/cli.ts benchmark:vanetik --no-cache
```

See `output/reports/2026-09-21T05-20-09-758Z-8fd57be1/report.md` and `vacancy-candidate-rankings.csv` for the scores and rankings. These public labels help validate ranking behavior; they do not supply match percentages or a reliable 25-resume same-JD test.

### Ten PDF resumes against the full-stack role

Latest chunked run ID: `2026-09-21T04-05-40-680Z-5168125c`. A one-pass run is retained at `2026-09-21T03-40-28-789Z-93969e92` to show the original truncation problem.

- All ten PDFs parsed and all ten local MPS evaluations completed; there were no failures or retries. The run used 39 chunk passes across ten resumes.
- Runtime was 59.6 seconds, with 146,294 input tokens across all chunk passes, zero output tokens, and zero provider-reported cost.
- All 14,133 normalized resume tokens were covered. Resumes used three to nine windows; each state used at most 716 tokens, under the 728-token budget. Window offsets and token coverage are in `output/reports/2026-09-21T04-05-40-680Z-5168125c/report.json`.
- Composite scores ranged from 69.36 to 73.86. Mean score was 70.35 for accountants and 72.45 for Information Technology resumes, a 2.10-point difference. Per-category dimension averages are included in the report.
- Confidence values remained low, ranging from 0.136 to 0.194.
- These PDFs have no fit labels. Their dataset categories only identify the example's resume category; the small score separation is a diagnostic signal, not a measured accuracy result.

Chunking now covers the full redacted resume text. The category mean gap changed from 1.08 points in the clipped run to 2.06 points in the chunked run; without fit labels, this does not show that the larger gap is more accurate. Do not use these scores to rank or reject candidates.

## Full-resume input handling

The model's fixed context cannot be expanded by assigning more Mac memory. The local multi-pass path tokenizes each normalized resume, divides it into overlapping windows sized after the job and question prompt, scores each window, then combines per-dimension probability distributions using a token-coverage-weighted mean. Result metadata contains chunk count, window offsets, per-window state tokens, overlap size, and full-coverage counts. Labeled validation is needed to determine whether the score differences track job fit. Runtime grows with the number of windows.

Deterministic extraction of high-relevance resume sections into one compact state remains an alternative for reducing latency. It may omit evidence, so compare it with the chunked path on held-out labels.

## Public repository release work

- Added `match --job <json> --resumes <directory>` for local PDF/TXT files, with nested folders, unsupported-file rejection, readable-text checks, a 25 MiB per-file limit, a 512 MiB total input limit, and a dry run that makes no model calls.
- Added anonymous ordinal candidate IDs, a private local filename map, CSV/JSON/Markdown rankings, and report limitations. The map remains under ignored `output/` and must not be published.
- Added CPU fallback, pinned checkpoint identity in model IDs/cache keys, public setup/privacy/benchmark/license/provider docs, a static Jekyll landing page, and GitHub Actions workflows for CI and Pages.
- The local 0–100 scores remain experimental and not calibrated. Public-release readiness does not make the model suitable for hiring decisions.
- This checkout has no Git remote or commit history. The Pages workflow is ready but has not been deployed; enable GitHub Pages Actions after connecting the public repository. Review `docs/site-publishing.md` before launch.

## Commands

```bash
uv sync --project python --locked
pnpm exec tsx src/cli.ts laya:smoke --count 10
pnpm exec tsx src/cli.ts benchmark:gold --limit 10 --seed 42 --no-cache
pnpm exec tsx src/cli.ts benchmark:pdf-sample --limit 10 --seed 42 --no-cache
pnpm typecheck
pnpm test
```

No 500–640 resume run has been started. The 106-pair results are not strong enough to justify scaling. More human-reviewed labels for the same job, including clear low-match examples, are needed before measuring ranking quality.
