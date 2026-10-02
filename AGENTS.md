# AGENTS.md

`v1.36 · 2026-10-02` — Quirks.

- `master` only; no branches. Commit/push only on request.
- Diagnosis: 10 evidence-informed attempts override the two-failure stop; preserve app retries, guards and timeouts.
- Local Ollama/Python Sidecar only; no cloud forwarding. Preserve filesystem gates, checkpoints, budgets, timeouts, loop/OOM safeguards.
- `.gitattributes`: LF, UTF-8 without BOM; no mass conversion.
- npm 11 preserves lockfile `libc`. After `npm ci`, Electron 43 needs `node node_modules/electron/install.js` (`setup:dev`/CI do this).
- Main/Renderer share `shared/`; IPC derives from `shared/ipc/ipcContract.ts`. Ports require enforced boundaries or second implementations.
- Chunks: native dimensions and versioned Nomic/Qwen preparation. Incompatible spaces need backed-up rebuild; prompt history stays raw until its own task.
- Normalization refusal: non-indexed draft; no persisted status or migration.
- Recover `document-recovery.json` before migration/maintenance; failure preserves the journal and blocks database access. Only `/health` exempts Sidecar authentication.
- Orphan reclamation requires exact process identity from `sidecar-ownership.json`; never reclaim a port by number alone.
- DOM tests outside Vitest `dom` need `// @vitest-environment happy-dom` first. Knip production rejects test-only exports unless `@internal`.
- LanceDB test table drop/recreate at the same URI needs a fresh native session; cached FTS metadata otherwise survives.
- `PROJECT_STATUS.json` is the canonical backlog; retain its `todos` string array. Evidence: `docs/`; model qualification differs from tests.
- Keep legacy sessions until real nonempty released data migrates with verified backup/readback. Host absence is insufficient; `Desktop/test_app` is read-only.
- Live artifacts use `%USERPROFILE%\OnlyRag-Live` (`ONLYRAG_LIVE_ROOT` overrides). Do not treat resumable Ollama blobs as app data.

Verified 2026-10-02 (PowerShell; Node 24/npm 11/Python 3.13):

- `npm run test:fast`: 293 files, 2388 tests.
- `.venv\Scripts\python.exe -m pytest -q`: 280 tests.
- `npm run typecheck`, `npm run quality:static`, `npm run audit:deadcode`, `npm run audit:cycles`, `npm run docs:check`, `npm run format:check`.
- `npm run generate:openapi` after schema changes; `npm run build`.

2026-09-30: `npm run package:win` (unsigned, PowerShell 7); `powershell -ExecutionPolicy Bypass -File scripts/test_uninstall_policy.ps1` (five isolated policy cases; no visual test).

Limits: `docs/verification.md`.
