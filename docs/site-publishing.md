---
layout: docs
title: Publish the project site
description: Enable GitHub Pages for the static marketing and documentation site.
permalink: /docs/site-publishing/
---

The project site is a static HTML/Jekyll site in this repository. The Pages workflow builds the root landing page, CSS, and Markdown documentation; it does not access resume inputs, cache, or benchmark outputs. Its project-site base path is set to `/resume-grader`.

## Enable GitHub Pages

1. In **Settings → Pages → Build and deployment**, choose **GitHub Actions** as the source if it is not already selected.
2. Confirm repository Actions settings permit the Pages workflow to run.
3. Push to `main` or `master`, or run **Publish project site** manually from the Actions tab.
4. Open `https://ranjeet-h.github.io/resume-grader/` and confirm the docs links and asset paths work.

The repo's Pages workflow deploys each successful default-branch push. GitHub Pages can take a few minutes to publish the first deployment.

## Before you announce it

- Read the [benchmark caveats](benchmark-methodology.md) and [privacy guidance](privacy-and-safety.md).
- Enable private vulnerability reporting under **Settings → Security → Code security and analysis**.
- Confirm the repository license is the one intended for original code. Model weights and dataset licenses remain separate.
- Review every staged path and ensure no raw/normalized dataset, report, cache, `.env`, or candidate map is included.
- Do not describe this PoC as validated hiring software. The benchmark does not yet evaluate a sufficiently labeled same-job candidate ranking.
