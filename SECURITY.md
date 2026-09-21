# Security policy

## Scope

This is a local research CLI, not a hosted service. Security reports about code, dependency handling, model downloads, or accidental data disclosure are in scope. Reports must not include a resume, candidate identifier tied to a real person, API token, private job description, or generated cache/report archive.

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** flow in the repository's Security tab when private vulnerability reporting is enabled. If it is not enabled, contact a maintainer privately before publishing details. Do not open a public issue for an unpatched vulnerability.

Before making the repository public, enable private vulnerability reporting and add a maintainer contact route to the repository settings.

## Supported versions

Only the latest default-branch version is supported. There are no published binary releases yet.

## Data handling

The CLI processes resume files locally and stores generated data under ignored local directories. This does not make the data encrypted or anonymized. Review [privacy and safe use](docs/privacy-and-safety.md) before using sensitive data.
