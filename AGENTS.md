# AGENTS.md

`v1.51 · 2026-10-06` — Quirks.

- `master` only; no branches. Commit/push only on request.
- Diagnosis: 10 informed attempts override two-failure stop; keep guards/timeouts/retries.
- Local Ollama/Sidecar only; keep filesystem gates/checkpoints/budgets/loop/OOM guards.
- npm 11 keeps `libc`; Electron 43 needs `node node_modules/electron/install.js` after `npm ci`.
- IPC: `shared/ipc/ipcContract.ts`; ports need boundaries or two implementations.
- Files: Preload resolves paths; refuse empty paths/basename fallbacks.
- Chunks: native dimensions/versioned Nomic/Qwen preparation; incompatible spaces need backed-up rebuild. Raw prompt history.
- Vision/normalization share `numCtx`; insufficient context keeps non-indexed originals; no migration.
- Recover `document-recovery.json` before DB access; failure preserves it/blocks access. Only `/health` exempts auth.
- Orphans need `sidecar-ownership.json` identity; never reclaim by port.
- Non-`dom`: `// @vitest-environment happy-dom`. Test-only exports: `@internal`.
- LanceDB drop/recreate URI reuse needs a fresh test session (FTS cache).
- Backlog: `PROJECT_STATUS.json` `todos`; evidence: `docs/`. Tests are not model qualification.
- State: only `ENOENT` means absent; invalid reads block writes. Keep seeds/explicit restore; cancel preserves edits/checkpoints, no auto-resume. Windows can omit `before-quit`.
- Legacy sessions need backup/readback migration; host absence proves nothing. `Desktop/test_app` read-only.
- Archives: `data/source-documents/<doc_id>`; validate chunks/revisions; no auto cleanup/migration.
- Modal owns Escape/focus/inert; approvals need explicit buttons.
- Unknown memory geometry stays uncertain; no admission bypass.
- Live: `%USERPROFILE%\OnlyRag-Live` (`ONLYRAG_LIVE_ROOT`); resumable Ollama blobs are not app data.

2026-10-06 (PS, Node24/npm11/Python3.13):

- `npm run test:fast -- --silent=true`: 305 files/2582 tests.
- `.venv\Scripts\python.exe -m pytest -q`: 343 tests.
- `npm run typecheck`, `npm run quality:static`, `npm run audit:deadcode`, `npm run audit:cycles`, `npm run docs:check`, `npm run format:check`.
- `npm run generate:openapi` after schema changes; `npm run build`.
- `node scripts/e2e/ingestionNativePath.mjs`.
- `node scripts/e2e/agentRendererLifecycle.mjs`.
- `node scripts/e2e/buildDownloadCachePolicy.mjs` (loopback).

2026-09-30: `npm run package:win` (unsigned/PS7); `powershell -ExecutionPolicy Bypass -File scripts/test_uninstall_policy.ps1` (5 cases, no visual).

Limits: `docs/verification.md`.
