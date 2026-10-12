# AGENTS.md

`v1.59 · 2026-10-12` — Quirks.

- `master` only; no branches. Commit/push only on request.
- Diagnosis: 10 informed attempts; retain guards/timeouts/retries.
- Local Ollama/Sidecar only; keep filesystem/checkpoint/budget/loop/OOM guards.
- npm 11 keeps `libc`; Electron needs `node node_modules/electron/install.js` after `npm ci`.
- IPC: `shared/ipc/ipcContract.ts`; ports need two implementations/boundaries.
- Planning: confirm ledger before candidates; bind reviews. Pin live budget/runtime/digest; retain spent markers; no legacy rewrite.
- Files: Preload resolves paths; refuse empty paths/basename fallbacks.
- Chunks: native/versioned spaces; raw prompt history. Rebuild CLI needs root/model; no personal migration.
- Tables: bounded CSV/Parquet, read-only XLSX; default XLS 8 MiB/XLSX strings 16 MiB guards. Excel opt-in uses a bounded RAG extract.
- Vision/normalization share `numCtx`; insufficient context keeps originals unindexed.
- Recover `document-recovery.json` before DB; failure preserves it and blocks. Only `/health` bypasses auth.
- DB owns SQLite lease; bad active-store manifest blocks startup. Orphans need PID/path/start identity.
- Non-`dom`: `// @vitest-environment happy-dom`. Test-only exports: `@internal`.
- LanceDB drop/recreate URI reuse needs a fresh test session (FTS cache).
- Backlog: `PROJECT_STATUS.json` todos; evidence: `docs/`. Tests do not qualify models.
- State: only `ENOENT` means absent; bad reads block writes. Explicit restore; cancel keeps checkpoints, no auto-resume. Windows may omit `before-quit`.
- Prompt history: Sidecar generation fence; REST restore needs matching operation. Main journal/IPC open.
- Legacy migration needs backup/readback; host absence proves nothing. `Desktop/test_app` read-only.
- Archives: `data/source-documents/<doc_id>`; validate chunks/revisions; no auto cleanup/migration.
- Modal owns Escape/focus/inert; approvals use explicit buttons.
- Unknown memory geometry cannot bypass admission.
- Release: `npm run package:win` makes CPU candidates; no `-SkipSidecar`. Retain old artifacts and source/notice gates.
- Live: `%USERPROFILE%\OnlyRag-Live` (`ONLYRAG_LIVE_ROOT`); resumable Ollama blobs are not app data.

Verified (PS, Node24/npm11/Python3.13):

- `npm run test:fast -- --silent=true`.
- `.venv\Scripts\python.exe -m pytest -q`.
- `npm run generate:openapi` after schema changes; `npm run build`.

- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test_cleanup_policy.ps1`: 31 WhatIf cases.

Cleanup: reviewed absolute DisposablePaths; Full protects profiles; name-only refuses. See `docs/verification.md`.
