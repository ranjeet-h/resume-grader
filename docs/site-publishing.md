---
layout: docs
title: Publish the project site
description: Enable GitHub Pages for the static marketing and documentation site.
permalink: /docs/site-publishing/
---

The project site is a static HTML/Jekyll site in this repository. The Pages workflow builds the root landing page, CSS, and Markdown documentation; it does not access resume inputs, cache, or benchmark outputs.

## Enable GitHub Pages

1. Push the reviewed source to a GitHub repository using `main` or `master` as the default branch.
2. In **Settings → Pages → Build and deployment**, choose **GitHub Actions** as the source.
3. Confirm the repository's Actions settings permit the Pages workflow to run.
4. Push to the default branch or run **Publish project site** manually from the Actions tab.
5. Review the `github-pages` environment deployment URL and open the site at mobile and desktop widths. Confirm the docs links and `baseurl` paths work for the repository site.

No deployment has been performed from this local checkout. There is no configured Git remote or existing commit history here. The workflow is ready for the repository owner to run after creating or connecting the public repository and enabling Pages.

## Before you announce it

- Read the [benchmark caveats](benchmark-methodology.md) and [privacy guidance](privacy-and-safety.md).
- Enable private vulnerability reporting under **Settings → Security → Code security and analysis**.
- Confirm the repository license is the one intended for original code. Model weights and dataset licenses remain separate.
- Review every staged path and ensure no raw/normalized dataset, report, cache, `.env`, or candidate map is included.
- Do not describe this PoC as validated hiring software. The benchmark does not yet evaluate a sufficiently labeled same-job candidate ranking.
