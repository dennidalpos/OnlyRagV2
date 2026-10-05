# AGENTS.md

`v1.41 · 2026-10-05` — Quirks.

- `master` only; no branches. Commit/push only on request.
- Diagnosis: 10 informed attempts override two-failure stop; preserve retries/guards/timeouts.
- Local Ollama/Python Sidecar only; no cloud forwarding. Preserve filesystem gates, checkpoints, budgets and loop/OOM safeguards.
- npm 11 preserves `libc`. Electron 43 needs `node node_modules/electron/install.js` after `npm ci` (`setup:dev`/CI).
- Main/Renderer share `shared/`; IPC derives from `shared/ipc/ipcContract.ts`. Ports need enforced boundaries or second implementations.
- Chunks: native dimensions, versioned Nomic/Qwen preparation. Incompatible spaces need backed-up rebuild; prompt history stays raw pending its task.
- Ingestion `numCtx` is shared by Vision/normalization. Missing/insufficient normalization context preserves the non-indexed original; no persisted status or migration.
- Recover `document-recovery.json` before maintenance; failure preserves it and blocks DB access. Only `/health` exempts Sidecar authentication.
- Orphans need exact identity from `sidecar-ownership.json`; never reclaim by port alone.
- DOM tests outside `dom` need `// @vitest-environment happy-dom` first. Knip production test-only exports need `@internal`.
- LanceDB drop/recreate at one URI needs a fresh test session; cached FTS metadata survives.
- `PROJECT_STATUS.json`: canonical `todos` string backlog. Evidence: `docs/`; tests differ from model qualification.
- Keep legacy sessions until nonempty released data migrates with verified backup/readback. Host absence is insufficient; `Desktop/test_app` is read-only.
- Archives: `data/source-documents/<doc_id>`; no automatic cleanup/migration. Validate chunk/revisions.
- Modal owns Escape/focus/inert; approvals require explicit buttons.
- Unknown memory geometry stays uncertain; fit cannot bypass admission.
- Live artifacts use `%USERPROFILE%\OnlyRag-Live` (`ONLYRAG_LIVE_ROOT` overrides). Resumable Ollama blobs are not app data.

2026-10-05 (PS, Node24/npm11/Python3.13):

- `npm run test:fast`: 297 files/2418 tests.
- `.venv\Scripts\python.exe -m pytest -q`: 336 tests.
- `npm run typecheck`, `npm run quality:static`, `npm run audit:deadcode`, `npm run audit:cycles`, `npm run docs:check`, `npm run format:check`.
- `npm run generate:openapi` after schema changes; `npm run build`.

2026-09-30: `npm run package:win` (unsigned, PS7); `powershell -ExecutionPolicy Bypass -File scripts/test_uninstall_policy.ps1` (five isolated cases; no visual test).

Limits: `docs/verification.md`.
