# Repository Instructions

`v1.3 · 2026-10-13`

## 1. Purpose & Current Stack

- Purpose: private local desktop workspace for document ingestion, RAG chat, translation and coding-agent workflows.
- Supported platform: Windows 10/11 x64; local Ollama and Python Sidecar.
- Stack: Electron, React, TypeScript, Vite, FastAPI, LanceDB and SQLite. The code and dependency manifests define current behavior.
- Toolchain: Node `>=24.19.0 <25`, npm `>=11 <12` (`package.json`), Python 3.13.15 (`README.md`); use PowerShell from the repository root.
- Canonical references: [`README.md`](./README.md), [`docs/README.md`](./docs/README.md), [`PROJECT_STATUS.json`](./PROJECT_STATUS.json) for open work, and [`docs/verification-current.md`](./docs/verification-current.md) for scoped evidence.

## 2. My Project Directives

These are user requirements. Do not rewrite them merely to match existing code. Flag conflicting requirements before dependent changes.

- Work on `master`; commit and push only when requested. Preserve personal stores, checkpoints, source archives, retained evidence and spent campaign markers. No personal-data migration or cleanup by name alone.
- Keep filesystem, authentication, checkpoint, budget, loop and memory guards; retain explicit failures, timeouts and recovery paths. Only `/health` bypasses Sidecar authentication. Treat source behavior as evidence, not automatically as intended behavior.
- Keep documentation concise, practical and split by scope. Check it against code and current authoritative sources; keep source comments short and useful.
- Use targeted checks for a concrete risk; run full suites only when a problem warrants them. Offline tests do not qualify live models, visual output, installed-app behavior or power-loss durability. Do not start new real-model campaigns without a scope decision.
- Preserve approved migration paths and frozen expectations. Changes to these directives need user authorization.
- Diagnose with at most ten informed attempts; retain guards, timeouts and retries. Planning needs a confirmed ledger, bound reviews, pinned budget/runtime/digest and retained spent markers; never rewrite legacy plans silently.
- Path resolution happens in Preload; refuse empty paths and basename fallbacks. Preserve native/versioned chunks and raw prompt history. Rebuilds require root and model identity.
- Keep tabular ingestion bounded: CSV/Parquet limits, read-only XLSX, default XLS 8 MiB and XLSX strings 16 MiB. Excel RAG extraction is opt-in and bounded; preserve ragged XLS rows. Vision and normalization share `numCtx`; low context keeps originals unindexed.
- Preserve explicit restore and cancellation checkpoints; never auto-resume. Prompt history uses a generation fence; REST restore matches the operation; Main retains incomplete staging and active runs block deletion.
- Legacy migration needs backup and readback; missing host evidence proves nothing. `Desktop/test_app` is read-only. Cleanup in Full mode protects profiles and refuses name-only matches.

## 3. Commands & Verification

Commands run in PowerShell from `D:\GITHUB\OnlyRagV2`; see [`docs/operations.md`](./docs/operations.md) for prerequisites and effects. Listing a command does not authorize installation, live inference, data deletion or publication.

| Task | Command | Verification / Notes |
| --- | --- | --- |
| Setup | `npm run setup:dev` | Not run in this documentation session; installs development dependencies. npm 11 retains `libc`; Electron may require `node node_modules/electron/install.js` after `npm ci`. |
| Build | `npm run build` | Last recorded build in [`docs/verification-current.md`](./docs/verification-current.md); not rerun for documentation. |
| Documentation | `npm run docs:check` | Verified 2026-10-13; local links, anchors and documented commands. |
| Targeted validator | `npx vitest run scripts/validate_documentation.test.mts --reporter=dot` | Verified 2026-10-13; six tests. |
| Full offline suites | `npm run test:fast -- --silent=true`; `.venv\Scripts\python.exe -m pytest -q` | Last recorded results in verification docs; not rerun for documentation. Requires the local environment; neither command qualifies live behavior. |

## 4. Boundaries & Gotchas

- IPC contract: `shared/ipc/ipcContract.ts`; keep Main, Preload and Renderer consumers synchronized. REST routes start in `sidecar/main.py`. Agent tool gates and `fullAccess` differ; see [`docs/coding-agent.md`](./docs/coding-agent.md).
- Rebuild and recovery require the original root/model context. Recover `document-recovery.json` before database startup; failure preserves it and blocks. Only `ENOENT` means absent; unreadable state blocks writes.
- Database startup owns its SQLite lease; an invalid store manifest blocks startup. Verify orphan process identity by PID, path and start time. LanceDB drop/recreate URI reuse needs a fresh session because of the FTS cache.
- Atomic writes flush the file before rename; directory sync and power-loss qualification remain open. Windows may omit `before-quit`.
- Modal dialogs own Escape, focus and inert state; approvals require explicit buttons. Unknown memory geometry cannot bypass admission.
- Tests outside the `dom` environment use `// @vitest-environment happy-dom` when needed; test-only exports use `@internal`. Verification uses a manager and unique lock; conflicts refuse. PowerShell scripts stay one-line at the call site and never auto-download or install.
- Generated or packaged outputs follow their scripts; do not hand-edit them. CPU package: `npm run package:win` without `-SkipSidecar`, retaining artifacts, matching source and notice gates; see [`docs/distribution.md`](./docs/distribution.md).
- Protected state includes `%USERPROFILE%\OnlyRag-Live` (or `ONLYRAG_LIVE_ROOT`), user profiles, `data/source-documents/<doc_id>`, `Desktop/test_app`, campaign artifacts and checkpoints. Validate archive chunks and revisions; do not clean or migrate automatically. Resumable Ollama blobs are not app data. Cleanup requires reviewed paths and specific authorization.
- Unqualified boundaries include restarted personal-app flows, broader model/content quality, DOCX visual layout, directory durability and real power loss; consult the tracker before claiming closure.

Maintain verified stack and command facts when they change. Keep task history in the existing tracker.
