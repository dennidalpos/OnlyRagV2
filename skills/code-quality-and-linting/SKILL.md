---
name: code-quality-and-linting
description: Choose OnlyRag verification commands when changing TypeScript, Python, IPC contracts, documentation, or release-bound code.
triggers: ["typecheck", "quality:static", "test:sidecar", "test:skills", "docs:check", "full checks"]
tags: ["verification", "lint", "build"]
---

# Verification commands

- Run targeted TypeScript tests with `npx vitest run <path>` and Python tests with `.venv\Scripts\python.exe -m pytest -q <path>`.
- Run `npm run typecheck` for TypeScript contracts and `npm run quality:static` for Biome, IPC registration and layering. `npm run test:skills` targets skill-domain tests.
- Run `npm run quality:python` for the offline Python admission/retrieval/persistence gate. It runs required existing regressions and rejects missing or skipped checks; it also runs inside `scripts/lint_format.ps1`, including `-SkipTests`.
- Run `npm run test:sidecar` for the Python Sidecar suite and optional health probe; `npm run generate:openapi` after REST contract changes.
- Run `npm run docs:check` for local Markdown links, anchors and npm script names. `npm run format:check` checks the diff with `git diff --check HEAD`.
- Use `npm run audit:cycles` for dependency cycles and `npm run audit:deadcode` for Knip when relevant.
- Before commit or push, run the repository gate `npm run test && npm run build`; report any failing command and keep its exit code visible.
