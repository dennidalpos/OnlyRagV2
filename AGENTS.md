# AGENTS.md

`v1.44 · 2026-10-06` — Quirks.

- `master` only; no branches. Commit/push only on request.
- Diagnosis: 10 informed attempts override two-failure stop; retain guards/timeouts/retries.
- Local Ollama/Sidecar only; keep filesystem gates, checkpoints, budgets, loop/OOM guards.
- npm 11 keeps `libc`; Electron 43 needs `node node_modules/electron/install.js` after `npm ci` (`setup:dev`/CI).
- IPC: `shared/ipc/ipcContract.ts`; ports need boundaries or two implementations.
- Native Files: Preload resolves paths; refuse empty paths, never use basenames.
- Chunks: native dimensions/versioned Nomic/Qwen preparation; incompatible spaces need backed-up rebuild. Prompt history stays raw.
- Vision/normalization share `numCtx`; insufficient/missing context keeps non-indexed originals; no status/migration.
- Recover `document-recovery.json` before DB access/maintenance; failure preserves it and blocks access. Only `/health` exempts auth.
- Orphans need `sidecar-ownership.json` identity; never reclaim by port.
- Outside `dom`, tests start with `// @vitest-environment happy-dom`. Knip test-only exports need `@internal`.
- LanceDB drop/recreate URI reuse needs a fresh test session (FTS cache).
- Backlog: `PROJECT_STATUS.json` `todos`; evidence: `docs/`. Tests are not model qualification.
- Agent state: only `ENOENT` means absence; invalid reads block writes. Keep seeds/explicit checkpoint restore.
- Keep legacy sessions until released data migrates with backup/readback. Host absence is insufficient; `Desktop/test_app` read-only.
- Archives: `data/source-documents/<doc_id>`; validate chunk/revisions; no auto cleanup/migration.
- Modal owns Escape/focus/inert; approvals need explicit buttons.
- Unknown memory geometry stays uncertain; no admission bypass.
- Live: `%USERPROFILE%\OnlyRag-Live` (`ONLYRAG_LIVE_ROOT` override); resumable Ollama blobs are not app data.

2026-10-06 (PS, Node24/npm11/Python3.13):

- `npm run test:fast -- --silent`: 299 files/2460 tests.
- `.venv\Scripts\python.exe -m pytest -q`: 343 tests.
- `npm run typecheck`, `npm run quality:static`, `npm run audit:deadcode`, `npm run audit:cycles`, `npm run docs:check`, `npm run format:check`.
- `npm run generate:openapi` after schema changes; `npm run build`.
- `node scripts/e2e/ingestionNativePath.mjs`: HTTP/chooser fixtures, native identity.

2026-09-30: `npm run package:win` (unsigned/PS7); `powershell -ExecutionPolicy Bypass -File scripts/test_uninstall_policy.ps1` (5 cases; no visual).

Limits: `docs/verification.md`.
