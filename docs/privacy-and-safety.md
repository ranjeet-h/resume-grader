---
layout: docs
title: Privacy and safe use
description: Know what runs locally, what is stored, and why redaction does not make a resume anonymous.
permalink: /docs/privacy-and-safety/
---

## Intended use

This repository is a proof of concept for local experiments. Its scores and ranking are not validated hiring criteria. Do not use the tool to make, recommend, or automate hiring, rejection, promotion, or compensation decisions. Do not treat score bands as calibrated probabilities.

Resume text can contain highly sensitive personal information. Before using any real candidate files, establish a lawful basis, notice and consent where required, access controls, retention rules, and a review process with qualified counsel and affected stakeholders. This software does not provide compliance certification.

## Network behavior

- Resume extraction, normalization, inference, caching, and reporting run locally.
- Startup may contact Hugging Face Hub to check the pinned snapshot; weights download from Hugging Face on first use. If configured, an optional Hugging Face token may be used for those Hub requests.
- The current build has no hosted inference provider. It does not send resumes to OpenRouter, OpenCode Zen, Vercel AI Gateway, or another model API.
- The Python worker removes common model API keys from its child-process environment. Keep any Hugging Face token in a local `.env` file or CLI login; never commit it.

## Redaction is best effort

The normalizer heuristically removes common email addresses, phone numbers, profile URLs, personal fields, and a name-like first line. These patterns can miss names and identifiers or remove job-relevant text. It is not a reliable anonymization system. Review the local workflow and use synthetic or properly consented data for experiments.

The scoring prompt excludes protected characteristics and directs the model to use job-related evidence. That instruction does not prove the model is unbiased or prevent all proxy effects. Audit results across relevant groups before any proposed use, and do not deploy this PoC for employment decisions.

## Local files and retention

The tool keeps source files where you put them. It writes:

- evaluation results and model responses under `cache/laya/`;
- run logs and reports under `output/`;
- normalized benchmark data under `data/normalized/`;
- any downloaded benchmark sources under `data/raw/`.

These directories are ignored by Git, but that is not encryption or access control. The ranking command creates `input-files.private.json` with candidate IDs and local filenames so you can map the ranking to source documents. Keep it private. Ranking exports and reports avoid storing resume text, but can still be sensitive because scores and candidate IDs are personal data when linkable.

On Unix-like systems, newly created output/cache/normalized directories and files are owner-only where the filesystem supports POSIX permissions. Existing files and Windows permissions are not hardened by this setting. Do not treat it as an access-control or encryption guarantee.

To remove generated run data after preserving anything you need, delete `cache/laya/`, `output/`, and `data/normalized/`. Remove `data/raw/` separately if you also want to delete downloaded source data. This is permanent file deletion through normal filesystem tools.

## Before publishing artifacts

1. Do not attach a real resume, private job description, source-file map, cache, output directory, or `.env` to an issue, pull request, benchmark report, or commit.
2. Review every new file with `git status --short` and `git diff --check` before committing. `.gitignore` reduces accidents; it cannot prevent explicitly forced additions.
3. Keep public benchmark exports limited to anonymized IDs and aggregate results. Confirm that the source dataset license permits your planned reuse.
4. Do not promise that local execution is anonymous, secure, bias-free, or legally compliant.
