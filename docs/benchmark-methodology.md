---
layout: docs
title: Benchmark methodology
description: What the current datasets and scores measure, what they do not measure, and what evidence is still missing.
permalink: /docs/benchmark-methodology/
---

## What the score means

The model returns four typed 0–4 ordinal scores and one must-have probability. The TypeScript rubric maps the ordinal answers to 0–100 and computes a weighted composite:

| Dimension | Weight |
| --- | ---: |
| Required skills | 35% |
| Relevant experience | 30% |
| Seniority | 15% |
| Domain match | 10% |
| Must-have probability | 10% |

The composite is a deterministic rubric score, **not** a calibrated probability, percentile, or likelihood of job success. The model's probabilities were trained for other decision workflows; resume matching has not been calibrated.

## Public vacancy-ranking sample

The [Vanetik/Kogan dataset](https://github.com/NataliaVanetik/vacancy-resume-matching-dataset) contains 65 anonymized resumes, five software vacancies, and two human rankings for the first 30 resumes. Each annotator ranks vacancies for a resume. The target use case here is usually ranking resumes for one vacancy, so the label direction does not directly match the product task.

The local run completed 150 resume-vacancy evaluations. Human-human pairwise agreement was 56.3%. Against mean human ranks, Laya reached 53.2% pairwise agreement and 0.078 mean Spearman correlation; BM25 reached 58.2% and 0.220. Laya had a better NDCG@5 in the run, so no single metric should be used to claim one method wins. In aggregate these results do not show a consistent Laya advantage. Repeated rank positions in two annotator-1 rows are retained as ties.

The per-vacancy candidate lists are useful for examining score behavior, but the labels do not validate those lists as candidate rankings for a fixed job. The raw source declares GPL-3.0 and is not bundled in this repository.

## Role Radar labeled pairs

The local gold adapter contains 106 resolved pairs spread over 84 job postings. Seventy-two postings have one label; the largest group has six. Labels range from 58 to 96 with no examples below 50. It cannot evaluate a full candidate ranking for one job, low-match cases, or score calibration across the intended 10–100% range.

The corrected run produced 8.86 points composite MAE and 0.282 Spearman correlation. The source composite includes location, while the model's composite does not, so this is not a like-for-like score comparison. Pairwise accuracy over the 12 multi-candidate groups was 0.673 for Laya and 0.591 for BM25, but the number and size of groups are too small for a strong conclusion.

This dataset may contain synthetic profiles and job records. It remains an evaluation aid, not hiring truth. The source data is downloaded separately and excluded from Git.

## Kaggle PDF sample

The ten-PDF diagnostic uses five Information Technology and five Accountant resume examples matched with one full-stack job fixture. All ten parsed and were scored in overlapping windows, but the resume categories are not fit labels and there are no human judgments for these pairs. The category score gap is not an accuracy measure.

## What would support a stronger claim

For the intended task, collect at least 25 candidates for the same real or carefully designed job, have two reviewers rank all candidates independently, include strong, partial, and clear non-matches, reconcile rubric disagreements, and keep an untouched holdout job for evaluation. Compare Laya with BM25 and a human-only baseline. Measure pairwise ranking accuracy, top-k recall/precision, inter-reviewer agreement, score calibration, and subgroup errors. Document consent and retention for any real resumes.

Until this is done, use the software to explore and debug matching methods—not to make employment decisions or to scale model-based candidate screening.
