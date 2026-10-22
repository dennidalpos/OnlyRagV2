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
- `npm run test:sidecar` always runs `.venv\Scripts\python.exe -m pytest -q` from the repository root (the `pytest.ini` suite) and propagates its exit code; it never contacts a running service, even when port 8000 is occupied. A missing interpreter or pytest fails with exit 2; `-PythonExe <path>` selects another interpreter. Direct pytest remains equivalent.
- After REST contract changes, `npm run generate:openapi` rewrites `sidecar/contracts/openapi-2.5.0.json`; review that diff with the schema and client changes.
- Run `npm run docs:check` for local Markdown links, anchors and npm script names. `npm run format:check` checks the diff with `git diff --check HEAD`.
- Use `npm run audit:cycles` for dependency cycles and `npm run audit:deadcode` for Knip when relevant.
- For pre-commit requirements, use [AGENTS.md](../../AGENTS.md#comandi-e-verifica). A build does not replace the required Python suite; use `.venv\Scripts\python.exe -m pytest` when the virtualenv is not activated. Keep native failures visible when sequencing commands in PowerShell.
- Repository skills use the `triggers` and `tags` fields parsed by `electron/core/infrastructure/filesystem/skillRepository.ts`. Preserve these supported fields even though the generic Codex skill validator rejects them; check YAML, paths and npm scripts, then run the repository parser tests as well as `npm run test:skills`.
