# AGENTS.md

`v1.31 · 2026-10-01` — Verified quirks.

- Work directly on `master`; never create branches. Commit and push only when explicitly requested.
- Diagnosis: 10 evidence-informed attempts per problem override the universal two-failure stop; app retries, guards and timeouts stay unchanged.
- Local Ollama and Python Sidecar only; cloud forwarding is out of scope. Preserve agent filesystem gates, checkpoints, budgets, timeouts, loop and OOM safeguards.
- `.gitattributes`: LF, UTF-8 without BOM; no mass conversion.
- Use npm 11 for dependency changes: npm 10 drops lockfile `libc` fields. Electron 43 has no postinstall; after `npm ci`, run `node node_modules/electron/install.js` before launching Electron (`setup:dev` and CI do this).
- Main/Renderer share `shared/`; IPC derives from `shared/ipc/ipcContract.ts`. Add ports only for enforced boundaries or second implementations.
- Recover `document-recovery.json` before any database migration or maintenance. Failed recovery preserves the journal and disables database access. Sidecar authentication exempts only `/health`.
- Orphan reclamation requires exact process identity from `sidecar-ownership.json`; never reclaim a port by number alone.
- DOM tests outside Vitest's `dom` project need `// @vitest-environment happy-dom` on the first line. Knip's production pass rejects test-only exports unless tagged `@internal`.
- `PROJECT_STATUS.json` is the canonical backlog; retain its `todos` string array. Evidence: `docs/`; model qualification is separate from deterministic tests.
- Keep legacy sessions until real nonempty released data migrates with verified backup/readback. Host absence is insufficient; `Desktop/test_app` is read-only.
- Live artifacts use `%USERPROFILE%\OnlyRag-Live` (`ONLYRAG_LIVE_ROOT` overrides). Do not treat resumable Ollama blobs as app data.

Verified in PowerShell on 2026-09-30 (Node 24, npm 11, Python 3.13):

- `npm run test:fast`: 288 files, 2321 tests.
- `.venv\Scripts\python.exe -m pytest -q` (full Sidecar).
- `npm run typecheck`, `npm run quality:static`, `npm run audit:deadcode`, `npm run audit:cycles`, `npm run docs:check`, `npm run format:check`.
- `npm run generate:openapi` after schema changes; `npm run build`, `npm run package:win` (installer confirmed unsigned via PowerShell 7).
- `powershell -ExecutionPolicy Bypass -File scripts/test_uninstall_policy.ps1`: five isolated NSIS policy cases; simulated selection, no visual test.

Verification limits: `docs/verification.md`.
