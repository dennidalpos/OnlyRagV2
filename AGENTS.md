# AGENTS.md

`v1.60 · 2026-10-13`

- `master` only; no branches. Commit/push on request.
- Diagnosis: 10 informed attempts; retain guards/timeouts/retries.
- Local Ollama/Sidecar; keep filesystem/checkpoint/budget/loop/OOM guards.
- npm 11 keeps `libc`; Electron needs `node node_modules/electron/install.js` after `npm ci`.
- IPC: `shared/ipc/ipcContract.ts`; ports need both ends.
- Planning: confirm ledger, bind reviews, pin budget/runtime/digest; retain spent markers; no legacy rewrite.
- Preload resolves paths; refuse empty paths/basename fallbacks.
- Chunks: native/versioned; raw prompt history. Rebuild needs root/model; no personal migration.
- Tables: bounded CSV/Parquet, read-only XLSX; XLS 8 MiB/XLSX strings 16 MiB defaults. Excel opt-in: bounded RAG extracts; xlrd ragged rows.
- Vision/normalization share `numCtx`; low context keeps originals unindexed.
- Recover `document-recovery.json` before DB; failure preserves it and blocks. Only `/health` bypasses auth.
- DB owns SQLite lease; bad store manifest blocks startup. Orphans need PID/path/start identity.
- Non-`dom`: `// @vitest-environment happy-dom`; test exports: `@internal`.
- LanceDB drop/recreate URI reuse needs a fresh session (FTS cache).
- Backlog: `PROJECT_STATUS.json`; evidence: `docs/`. Tests do not qualify models.
- Only `ENOENT` means absent; bad reads block writes. Explicit restore; cancel keeps checkpoints, no auto-resume. Windows may omit `before-quit`.
- Prompt history: generation fence; REST restore matches operation. Main retains incomplete staging; active runs block deletion.
- Legacy migration needs backup/readback; host absence proves nothing. `Desktop/test_app` read-only.
- Archives: `data/source-documents/<doc_id>`; validate chunks/revisions; no auto cleanup/migration.
- Modal owns Escape/focus/inert; approvals need explicit buttons.
- Unknown memory geometry cannot bypass admission.
- CPU: `npm run package:win`; no `-SkipSidecar`. Retain artifacts/source/notice gates.
- Live: `%USERPROFILE%\OnlyRag-Live` (`ONLYRAG_LIVE_ROOT`); resumable Ollama blobs are not app data.
- Atomic writes flush before rename; directory/power-loss gates open.
- Verification: manager/unique lock; conflicts refuse. PS: one line, no auto downloads/installs.

Verified (PS, Node24/npm11/Python3.13):

- `npm run test:fast -- --silent=true`; `.venv\Scripts\python.exe -m pytest -q`.
- `npm run build`.

Cleanup: reviewed DisposablePaths; Full protects profiles; name-only refuses. `docs/verification.md`.
