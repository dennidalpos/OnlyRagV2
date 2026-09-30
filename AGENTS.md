# AGENTS.md

`v1.27 · 2026-09-30` — Verified repository quirks.

- Work directly on `master`; never create branches. Commit and push only when explicitly requested.
- Local Ollama and Python Sidecar only; cloud forwarding is out of scope. Preserve agent filesystem gates, checkpoints, budgets, timeouts, loop and OOM safeguards.
- `.gitattributes` requires LF; use UTF-8 without BOM. Do not mass-convert files.
- Use npm 11 for dependency changes: npm 10 drops lockfile `libc` fields. Electron 43 has no postinstall; after `npm ci`, run `node node_modules/electron/install.js` before launching Electron (`setup:dev` and CI do this).
- Main and Renderer share code through `shared/`; IPC contracts derive from `shared/ipc/ipcContract.ts`. Add a domain port only for an enforced boundary or a second implementation.
- Recover `document-recovery.json` before any database migration or maintenance. Failed recovery preserves the journal and disables database access. Sidecar authentication exempts only `/health`.
- Orphan reclamation requires exact process identity from `sidecar-ownership.json`; never reclaim a port by number alone.
- DOM tests outside Vitest's `dom` project need `// @vitest-environment happy-dom` on the first line. Knip's production pass rejects test-only exports unless tagged `@internal`.
- `PROJECT_STATUS.json` is the canonical backlog; retain its `todos` string array. Historical evidence is in `docs/`; model qualification remains separate from deterministic tests.
- Keep legacy session compatibility until real nonempty released data has migrated with verified backup/readback; absence on this host is insufficient. The registered `Desktop/test_app` is a read-only regression reference.
- Live artifacts use `%USERPROFILE%\OnlyRag-Live` (`ONLYRAG_LIVE_ROOT` overrides). Do not treat resumable Ollama blobs as app data.

Verified in PowerShell on 2026-09-30 (Node 24, npm 11, Python 3.13):

- `npm run test:fast`: 287 files, 2293 tests.
- `.venv\Scripts\python.exe -m pytest -q` (full Sidecar).
- `npm run typecheck`, `npm run quality:static`, `npm run audit:deadcode`, `npm run audit:cycles`, `npm run docs:check`, `npm run format:check`.
- `npm run generate:openapi` after schema changes; `npm run build`, `npm run package:win` (signature unverified).
- `powershell -ExecutionPolicy Bypass -File scripts/test_uninstall_policy.ps1`: five isolated NSIS policy cases; simulated selection, no visual test.

Verification limits: `docs/verification.md`.
