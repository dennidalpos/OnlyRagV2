# AGENTS.md

`v1.56 · 2026-10-10` — Quirks.

- `master` only; no branches. Commit/push only on request.
- Diagnosis: 10 informed attempts override two-failure stop; keep guards/timeouts/retries.
- Local Ollama/Sidecar only; keep filesystem gates/checkpoints/budgets/loop/OOM guards.
- npm 11 keeps `libc`; Electron needs `node node_modules/electron/install.js` after `npm ci`.
- IPC: `shared/ipc/ipcContract.ts`; ports need boundaries or two implementations.
- Planning: confirm ledger before candidates; bind review references. Live budgets are explicit; pin runtime/digest, retain spent markers. No legacy rewrite.
- Files: Preload resolves paths; refuse empty paths/basename fallbacks.
- Chunks: native/versioned spaces; raw prompt history. Rebuild CLI needs explicit root/model; no personal migration.
- Vision/normalization share `numCtx`; insufficient context keeps originals unindexed.
- Recover `document-recovery.json` before DB access; failure preserves it/blocks access. Only `/health` exempts auth.
- DB owns SQLite lease; invalid active-store manifest blocks startup. Orphans need PID/path/start identity.
- Non-`dom`: `// @vitest-environment happy-dom`. Test-only exports: `@internal`.
- LanceDB drop/recreate URI reuse needs a fresh test session (FTS cache).
- Backlog: `PROJECT_STATUS.json` `todos`; evidence: `docs/`. Tests are not model qualification.
- State: only `ENOENT` means absent; bad reads block writes. Keep seeds/explicit restore; cancel preserves edits/checkpoints, no auto-resume. Windows may omit `before-quit`.
- Legacy migration needs backup/readback; host absence proves nothing. `Desktop/test_app` read-only.
- Archives: `data/source-documents/<doc_id>`; validate chunks/revisions; no auto cleanup/migration.
- Modal owns Escape/focus/inert; approvals use explicit buttons.
- Unknown memory geometry cannot bypass admission.
- Live: `%USERPROFILE%\OnlyRag-Live` (`ONLYRAG_LIVE_ROOT`); resumable Ollama blobs are not app data.

Verified on PS, Node24/npm11/Python3.13:

- `npm run test:fast -- --silent=true`: 306 files/2605 tests.
- `.venv\Scripts\python.exe -m pytest -q`: 388 tests (2026-10-10).
- `npm run generate:openapi` after schema changes; `npm run build`.
- `node scripts/e2e/agentRendererLifecycle.mjs`.
- `node scripts/e2e/dependencyScannerIsolation.mjs`.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test_cleanup_policy.ps1`: 31 WhatIf cases.

Cleanup needs reviewed absolute DisposablePaths; Full protects profiles; name-only stop refuses. See `docs/verification.md`.
