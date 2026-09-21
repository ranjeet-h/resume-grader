---
layout: docs
title: Documentation
description: Install the local matcher, prepare data, reproduce the benchmark, and understand its limits.
permalink: /docs/
---

This repository is a local-first **research toolkit** for studying resume-to-job matching. It is not a hiring product or a validated employment decision system.

## Use the CLI

- [Quick start](quickstart.md) — install the runtimes, prepare a job JSON file and local PDF/TXT resumes, run a dry run, then export a ranking.
- [Privacy and safe use](privacy-and-safety.md) — learn what stays local, what gets written to disk, what redaction misses, and how to clear outputs.
- [Provider architecture](providers.md) — understand the replaceable evaluator seam and the current local Laya adapter.
- [Publish the project site](site-publishing.md) — enable the GitHub Pages deployment after connecting the public repository.

## Evaluate the method

- [Benchmark methodology](benchmark-methodology.md) — review the datasets, label direction, metrics, baseline comparison, and known gaps.
- [Model and data licenses](model-and-data-licenses.md) — check the code license and the separate terms of the model and optional datasets.

## Contribute

Read the repository [contribution guide](../CONTRIBUTING.md) and [security policy](../SECURITY.md). Never open an issue or pull request containing a real resume, job applicant information, access token, or private benchmark data.
