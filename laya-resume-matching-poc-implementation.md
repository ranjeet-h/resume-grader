# Laya Resume-to-Job Matching PoC

## Goal

Build a reproducible local proof of concept that compares resumes with job descriptions using multiple job-related dimensions, captures model/runtime behavior, and measures quality against labeled examples. It must not send candidate text to an unapproved hosted inference service or treat model output as an employment decision.

## Current implementation

- **Runtime:** TypeScript CLI, Python 3.12 managed by `uv`, local PyTorch MPS on Apple Silicon with CPU fallback.
- **Model:** Hugging Face `convaiinnovations/laya:typed-decisions` (421M parameters, published 1,024-token context), pinned to commit `1c5edc17a7acd8701df6fc341c0d179f1c62c982`.
- **Provider boundary:** generic `CandidateEvaluator` contract; local Laya is the only configured provider.
- **Inputs:** normalized job and redacted resume, including title, seniority, and description.
- **Custom matching:** `match --job <json> --resumes <directory>` accepts local PDF/TXT inputs; `--dry-run` validates extraction and counts without loading Laya.
- **Dimensions:** required skills, relevant experience, seniority, domain match, and must-have probability.
- **Long resumes:** overlapping token windows, job included in each pass, weighted probability aggregation, and token coverage/window offsets in metadata.
- **Output:** deterministic weighted composite, per-dimension scores/probabilities/confidence, token usage, latency, device, model revision, cache and run metadata, and JSON/Markdown reports.
- **Data paths:** local raw datasets under `data/raw/`, job fixtures under `data/fixtures/`, ignored run artifacts under `output/`.

## Matching rubric

The local model answers four ordinal 0–4 score questions and one probability question. TypeScript normalizes the ordinal dimensions to a 0–100 scale and calculates the composite independently of the model.

| Dimension | Weight |
| --- | ---: |
| Required skills | 35% |
| Relevant experience | 30% |
| Seniority | 15% |
| Domain match | 10% |
| Must-have probability | 10% |

The rubric does not include age, protected characteristics, or personal contact details. It asks for evidence from the supplied resume and role only. Human review is required; a score is not a hiring recommendation.

## Model and machine fit

The selected typed-decisions checkpoint uses a 421M-parameter ModernBERT-large encoder and a 1,024-token context. The author's reported 0.766 accuracy is on four unrelated decision workflows and does not validate resume matching. Other Laya variants are a 512-token English base and a 1,024-token multilingual base; the PoC selected typed-decisions for its typed question interface, not for proven recruiting accuracy.

The worker uses `uv` and the local Hugging Face cache. It runs the model once per process and records the chosen device. No model conversion to MLX or ONNX is required for this PoC.

### Context limitation and chunked evaluation

The model's 1,024 tokens include space for the questions and decision head. The worker reserves 728 tokens for the combined job and resume state. Long resumes use overlapping windows. The worker keeps complete job descriptions when they fit with a useful resume window, and uses a bounded head/tail excerpt for longer JDs.

More RAM does not increase the checkpoint's sequence length. The PDF evaluator now uses overlapping windows:

- It tokenizes the normalized, redacted resume and divides it into overlapping windows that fit after the job text and decision prompt. When a resume is short, the worker can retain the complete JD; long JDs are compacted only as needed to reserve up to 400 resume tokens per window.
- Each window is scored with the same job and typed questions.
- Per-dimension probability distributions are averaged by the number of newly covered resume tokens in each window; confidence values and must-have probabilities use the same coverage weights.
- Reports retain chunk offsets, state token counts, overlap size, total unique covered tokens, and the aggregation method.
- The ten-PDF run verified that total unique covered tokens equaled the full tokenized resume length for every resume.

Repeated window scores are not automatically calibrated for whole-resume decisions. This aggregation is experimental and must be compared with the one-pass baseline on held-out labeled pairs before scaling. Deterministic extractive compression remains an alternative for lower latency; it may omit evidence.

## Data sources and small evaluation

### Human-reviewed pair sample

The Role Radar adapter joins human-reviewed job/profile pairs and compares model dimensions and composite against those labels and a BM25 baseline. All 106 resolved gold pairs were scored. They span 84 postings: 72 have one labeled candidate, 12 have multiple, and the largest group has six. Gold composites range from 58 to 96, with no labels below 50. The dataset cannot validate 25 candidates for one JD or the full range of 10–100% match bands.

The public [Vanetik/Kogan dataset](https://github.com/NataliaVanetik/vacancy-resume-matching-dataset) provides two human rankings of five vacancies for each of 30 anonymized resumes. It is useful for a small ranking check, but its label direction is resume-to-vacancy, and its ordinal ranks are not match percentages. The repository declares GPL-3.0.

### PDF resume sample

Ten individual public Kaggle resume-example PDFs were downloaded: five Information Technology and five Accountant category examples. The category is selection metadata, not match ground truth. The sample was matched against a paraphrased Synechron Bengaluru Full-Stack Developer posting (`data/fixtures/synechron-fullstack-job.json`).

The command intentionally caps the PDF experiment at ten files:

```bash
pnpm exec tsx src/cli.ts benchmark:pdf-sample --limit 10 --seed 42 --no-cache
```

The run reports page count, extracted characters, composite and five dimensions, confidence, token count, and latency per resume. It stores IDs and scores rather than resume text in reports. PDFs and run artifacts are excluded from Git.

## Observed runs (2026-09-21)

### 106-pair labeled sample

- Corrected run `2026-09-21T04-29-51-713Z-db3a800f`: 106/106 successful on MPS; 357,736 input tokens; zero output tokens and zero provider-reported cost; 170.7 seconds.
- All 6,491 resume tokens were covered across 106 windows. Maximum state size was 716 tokens under the 728-token budget; 51 JDs were compacted to fit.
- Composite MAE was 8.86 points and Spearman was 0.282. Skills Spearman was 0.376; seniority -0.092; domain 0.008.
- Pairwise ordering accuracy over the 12 multi-candidate job groups was 0.673 for Laya and 0.591 for BM25. No top-10 metrics are reported because no job group has more than six labels.
- These results show weak agreement in several dimensions, not validated recruiting accuracy. The source set has no examples below 50, and Role Radar's composite includes location while Laya's does not.

### Vanetik/Kogan human-ranking sample

- Run `2026-09-21T05-20-09-758Z-8fd57be1`: 150/150 pairs succeeded locally; 1,187,100 input tokens; zero output tokens or provider-reported cost; 548.9 seconds.
- The human task is to rank five vacancies for each of 30 resumes. Human-human pairwise agreement was 0.563. Two annotator-1 rows contain repeated positions and were scored as ties.
- Mean pairwise agreement was 0.540 for Laya and 0.590 for BM25; mean per-resume Spearman was 0.093 for Laya and 0.209 for BM25. This provides no reliable evidence that Laya is better than a lexical baseline.
- All per-resume scores and the per-vacancy candidate lists are in `output/reports/2026-09-21T05-20-09-758Z-8fd57be1/`. Candidate lists are model-only rankings; the source labels do not directly validate ranking candidates for a fixed job.

### Ten-PDF full-stack sample

- Chunked run `2026-09-21T04-05-40-680Z-5168125c`: 10/10 PDFs scored on MPS; 39 window evaluations; 146,294 input tokens; zero output tokens and zero provider-reported cost; 59.6 seconds total.
- All 14,133 normalized resume tokens were covered across the sample. Each candidate used three to nine overlapping windows; maximum state size was 716 tokens under the 728-token budget.
- Composite scores ranged from 69.36 to 73.86. Mean score was 70.35 for accountant examples and 72.45 for IT examples, a 2.10-point difference. Confidence ranged from 0.136 to 0.194.
- There is no fit ground truth for these resume/job pairs, and the dataset categories are not job-fit labels. This is a technical coverage and scoring diagnostic, not an accuracy estimate.

See `IMPLEMENTATION.md` and `output/reports/2026-09-21T04-05-40-680Z-5168125c/` for report details. The earlier one-pass result remains at `output/reports/2026-09-21T03-40-28-789Z-93969e92/` for comparison.

## Completion criteria before a larger run

- [x] Local model loads from the Hugging Face cache through `uv`.
- [x] Synthetic local inference works on MPS.
- [x] Generic provider contract and local-only Laya configuration are in place.
- [x] 106-pair labeled sample and ten-PDF diagnostic run complete.
- [x] Public 30-resume/five-vacancy human-ranking dataset normalized and scored against both annotators and BM25.
- [x] Full-resume chunking covers every normalized resume token in the PDF sample.
- [x] Per-dimension aggregation is implemented and documented.
- [ ] Aggregation is unit-tested and calibrated against held-out human labels.
- [ ] Chunked/compressed approach improves held-out quality relative to one-pass baseline.
- [ ] Human-reviewed resume/JD labels are sufficient for calibration and ranking evaluation.
- [ ] Review privacy, consent, data retention, and fairness requirements before any real candidate use.

Do not use these scores to rank or reject candidates. Collect substantially more same-JD human labels, particularly low-match examples, before scaling the benchmark or evaluating hiring use.
