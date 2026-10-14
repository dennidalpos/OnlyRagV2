# Repository audit — 2026-10-14

Scope: current `master` checkout, repository instructions, `PROJECT_STATUS.json`, architecture and verification guides, TypeScript/Electron/Python source, scripts, dependency graph and security boundaries. No local model call, installed-app run, personal-store migration, release or retained-artifact cleanup was performed. Earlier dated audits remain historical evidence.

## Cross-check against requirements

| Requirement | Current evidence | Residue |
| --- | --- | --- |
| Local desktop and responsive renderer | Electron entry point, typed IPC, React/Vite renderer and Sidecar are present; prior fixed-width checks are recorded in verification docs. | Real installed-desktop and assistive-technology qualification remain open. |
| Document ingestion, retrieval and translation | Active source paths and frozen corpora are documented in `ingestion.md`, `retrieval.md` and `translation.md`. | Broader multilingual content, scanned tables, large files, durable history and complete-document coverage remain open. Passing fixtures are not universal quality acceptance. |
| Coding Agent | Runtime, guards and retained request-ledger/TaskLab evidence are documented in `agent-runtime.md`. | Full real-model extraction/planning and complete TaskLab sequences remain unqualified; the owner paused new live campaigns. |
| Distribution | CPU candidate, notices and source archive have local evidence in `distribution.md`. | Component rights, matching public delivery, installed update/rollback and wider OCR parity remain open. |
| Tracker and local memory | The tracker used a 49-item `todos` array, contrary to `AGENTS.md`; `memory.md` was missing. | Closed the repaired Knip item, migrated the other 48 IDs to priority-ordered autonomous/user-required arrays and added concise local memory. |

## Code, residue and security findings

- `npm run audit:deadcode` initially failed because `scripts/e2e/dependencySprintfExposure.mjs` imported transitive `app-builder-lib` directly. The probe now resolves it through the declared `electron-builder` dependency; both Knip passes and the probe pass. This removes an accidental lockfile-hoisting dependency without adding a package.
- Search across active source found no untracked implementation `TODO`/`FIXME` markers. Matches are prompt text and negative test fixtures. The retired chunk-context CLI is a deliberate refusal with documentation and a safety test, so removal would weaken an active guard. Legacy session migration remains explicitly tracked until nonempty migration/readback is qualified.
- `electron/core/infrastructure/process/ollamaInstallerRepository.ts` downloads `OllamaSetup.exe` from the network and executes it without a pinned checksum or signature verification. Redirect handling accepts a new HTTPS destination without origin policy; the method can report success before installation completes. This is a concrete supply-chain and completion-state gap, tracked as `OLLAMA-INSTALLER-INTEGRITY-01` (P1). No installer was run.
- `npm audit --json` reports 16 package findings (6 high, 10 moderate); `npm audit --omit=dev --json` reports 7 (4 high, 3 moderate). Most affected paths are `depcheck`/`braces`/`sprintf-js` and the Electron build chain. These are advisory counts, not proof of application exploitability. Existing tracker items retain upstream mitigation/qualification; no unreviewed downgrade or lockfile edit was made.
- The Sidecar pins dependencies in `sidecar/requirements-common.txt`, `requirements.txt` and `requirements-release.txt`. No Python advisory scanner is installed in the repository environment, so those packages were not vulnerability-qualified in this audit. `PYTHON-DEPENDENCY-ADVISORY-AUDIT-01` tracks the missing check.
- Source review found Electron `nodeIntegration: false`, `contextIsolation: true` and a renderer Content Security Policy. The reviewed process and browser-tool paths include local-path and loopback guards. This spot check is not a penetration test and does not close the open security or reliability tasks.

## Verification

The audit used `rg`, Knip, npm audit and focused source review. `npm run audit:deadcode`, the targeted `dependencySprintfExposure.mjs` probe, `npm run quality:static`, `npm run docs:check`, `npm run test` (310 files, 2,685 tests), `npm run build` and `git diff --check` passed. `npm audit` remains nonzero for the advisories above. These checks do not qualify the installed application or real-model content.

`PROJECT_STATUS.json` is the active backlog. Its 50 IDs comprise 48 preserved open items and two new security findings: 32 autonomous, 18 requiring user action, ordered P1 through P3 within each list. The completed `DEPENDENCY-APP-BUILDER-LIB-UPSTREAM-01` item was removed immediately. Historical campaign details remain in the dated documents rather than in the tracker.
