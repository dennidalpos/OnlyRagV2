---
name: code-quality-and-linting
description: Verified local quality commands for OnlyRag V2.
---

# Quality checks

- Start with the smallest relevant check; do not hide pre-existing failures.
- `npm run test:fast` runs the Vitest suite.
- `npm run test:sidecar` checks the Python Sidecar.
- `npm run typecheck` checks TypeScript; `npm run quality:static` runs Biome lint.
- `npm run audit:cycles` checks dependency cycles; `npm run audit:deadcode` runs Knip.
- `npm run docs:check` validates local Markdown links and documented npm scripts.
- `npm run format:check` checks the current diff for whitespace and conflict markers.

Commands and packaging/cleanup details are maintained in `docs/operations.md`.
