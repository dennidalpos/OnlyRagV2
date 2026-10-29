---
name: code-quality-and-linting
description: Select and interpret OnlyRag local checks for TypeScript, Python, IPC, documentation and repository skill changes.
triggers: ["typecheck", "quality:static", "test:sidecar", "test:skills", "docs:check", "full checks"]
tags: ["verification", "lint", "build"]
---

# Verification commands

- From the repository root, use `npx vitest run <path>` or `.venv\Scripts\python.exe -m pytest -q <path>`. Pre-commit gates remain in [AGENTS.md](../../AGENTS.md#comandi-e-verifica); retain native exit codes when sequencing PowerShell commands.
- `vitest.config.mts` loads `scripts/test/nodeSetup.ts` before Node application imports to isolate storage and logs. Partial mocks importing the original resolver can escape that fixture. `sidecar/tests/conftest.py` sets Python storage before Sidecar imports.
- `npm run typecheck` checks TS contracts; `npm run quality:static` checks Biome, IPC and layering. `npm run docs:check` checks Markdown links/anchors/scripts. `npm run format:check` runs `git diff --check HEAD`, not Biome. Use `npm run audit:cycles` or `npm run audit:deadcode` when relevant.
- `npm run test:sidecar` always invokes the root `pytest.ini` suite, with no live-service branch. Missing Python/pytest returns exit 2. Select another interpreter with `pwsh -NoProfile -File scripts/test_sidecar_health.ps1 -PythonExe "<python-executable>"`.
- `npm run quality:python` requires all critical Python cases without skips, even inside `scripts/lint_format.ps1 -SkipTests`. If pytest is missing, report it or use a declared isolated environment. An overlay does not reproduce another interpreter's native-worker layout; this gate removes `PYTHONPATH`.
- `npm run generate:openapi` imports the actual Sidecar and rewrites `sidecar/contracts/openapi-2.5.0.json`. For generator validation, set `ONLYRAG_DATA_DIR` to an owned root before import; review schema/client/fixture differences together.
- Skill changes require catalog YAML, link, literal-path and npm-script checks, `npm run test:skills`, and `npx vitest run electron/core/infrastructure/filesystem/skillRepository.test.ts`. The suites alone do not validate the catalog. Preserve native `triggers`/`tags` from `skillRepository.ts`, although the generic Codex validator rejects them.
