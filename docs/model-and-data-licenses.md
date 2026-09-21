---
layout: docs
title: Model and data licenses
description: The source code license does not change the separate terms for model weights, packages, or optional benchmark data.
permalink: /docs/model-and-data-licenses/
---

## Repository code

The `LICENSE` file applies to original source code and documentation in this repository. It does not sublicense model weights, Python packages, job advertisements, resumes, or benchmark datasets.

## Model checkpoint

The selected `convaiinnovations/laya:typed-decisions` checkpoint is downloaded from [the Laya Hugging Face repository](https://huggingface.co/convaiinnovations/laya/tree/main/typed-decisions). The model card identifies the checkpoint as Apache-2.0. Review the license and model card at the pinned revision before redistribution or commercial use. This repository downloads model weights at runtime and does not redistribute them.

The Python `laya` package and all transitive packages have their own licenses. They are installed by `uv` from the locked dependency set; this project does not relicense those packages.

## Optional datasets

- [Vanetik/Kogan vacancy-resume matching dataset](https://github.com/NataliaVanetik/vacancy-resume-matching-dataset): source repository declares GPL-3.0 and requests citation of the associated paper. It is downloaded separately, not bundled here. Review the repository's license and attribution requirements before use.
- [Kaggle Resume Dataset](https://www.kaggle.com/datasets/snehaanbhawal/resume-dataset): Kaggle metadata lists CC0. The examples originate from a public resume-example site and may still contain identifying information. Do not publish personal resume content merely because a dataset card lists a permissive license.
- [Role Radar dataset](https://huggingface.co/datasets/oksomu/role-radar-dataset): the current dataset card identifies Apache-2.0. Its profiles include synthetic content; review provenance, privacy terms, and its label-generation notes before using the data.
- ATS validation sources: download and review the current source license, privacy terms, and label provenance before use. These files are not bundled with the public repository.

## Before a public release

Keep downloaded files, normalized candidate text, reports, cache entries, and private input maps out of version control. Verify this locally with `git status --short` and `git check-ignore -v <path>`. A source citation is not a license grant; seek legal review if the rights or permitted use are unclear.
