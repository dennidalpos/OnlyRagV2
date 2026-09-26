# AGENTS.md

`v1.20 · 2026-09-26` — Repository facts and verified commands.

## Scope

- Local desktop AI assistant and coding studio with RAG, Ollama, and Python Sidecar. Cloud LLM forwarding and proprietary remote services are out of scope.
- Keep Renderer and Main isolated; share only through `shared/`. CPU offload is acceptable when needed for correctness; retain OOM, timeout, anomaly, loop, and eviction safeguards.

## Verified commands

Run from repository root in PowerShell. On 2026-09-25 on Windows (Node 24, Ollama on an RTX 2070) the Sidecar tests and all six E2E commands passed. After the coding-agent audit and the removal of the text tool protocol, on 2026-09-26 the static checks (typecheck, `quality:static`, `audit:deadcode`, `audit:cycles`, `docs:check`), `npm run test:fast` (275 files, 2191 tests) and the Electron Agent, bundle/viewport, settings bootstrap and cold-start E2E passed; the Sidecar tests could not run because `.venv` points to an uninstalled Python 3.12 (ENV-PYTHON312-VENV-01). `qwen3.8:27b` is installed; its full-task rerun after the audit is pending (QWEN38-FULLTASK-01). The live test timeout now matches the 180-minute session limit. Installer and full audit were not rerun. Live workspaces and audit snapshots go to `%USERPROFILE%\OnlyRag-Live` (`ONLYRAG_LIVE_ROOT` overrides). In a container without `node_modules`, `npm ci --ignore-scripts` with `ELECTRON_SKIP_BINARY_DOWNLOAD=1` suffices for static checks and the fast suite; change dependencies with `npx npm@11`, since npm 10 drops lockfile `libc` fields.

| Purpose | Command |
| --- | --- |
| Fast suite | `npm run test:fast` (275 files, 2191 tests; 22 `itWithPowerShell` cases skip off Windows; `node` project for `electron/`, `shared/`, `src/services/`, `src/constants/`, `scripts/`, `dom` project for the rest of `src/`) |
| Sidecar tests | `.venv\Scripts\python.exe -m pytest -q` (133 tests) |
| Electron Agent E2E | `npm run test:e2e:electron` (8 reliability + 9 guard scenarios) |
| Sidecar ownership E2E | `npm run test:e2e:sidecar-ownership` (2 tests; requires free `:8000` and built `sidecar.exe`) |
| Cold-start network E2E | `npm run test:e2e:cold-start` (Main and Renderer first launch) |
| Settings bootstrap E2E | `npm run test:e2e:settings-bootstrap` |
| Bundle and viewport E2E | `npm run test:e2e:bundle-ux` (1024×700 and 1400×900) |
| Ingestion and translation E2E | `npm run test:e2e:ingest-translate` (dev Sidecar from `.venv`, real Ollama models from `settings.json`, free `:8000`) |
| Static quality | `npm run quality:static` (Biome lint errors, format-check of every file, IPC and layering guards; `noExplicitAny` is an error in every file, tests included) |
| Installer | `npm run package:win` (output in `release/`; Vite owns and empties `dist/`) |
| Full audit | `powershell -ExecutionPolicy Bypass -File ./scripts/audit_codebase.ps1 -Fast` |
| Targeted Vitest | `npx vitest run <path>` |
| Format / types | `npm run format:check`; `npm run typecheck` (includes `scripts/live` and `scripts/e2e`) |
| Dead code / cycles | `npm run audit:deadcode` (knip, then `knip --production`: test-only exports fail it unless tagged `@internal`); `npm run audit:cycles` |

## Architecture

- `src/` (Renderer) and `electron/` (Main) import shared code only from `shared/`. Every IPC channel is declared once in `shared/ipc/ipcContract.ts` (one object payload or none); the preload, `secureIpcMain.handle` and `IElectronAPI` derive from it.
- Main layers: `electron/core/{presentation,application,domain,infrastructure}`. Domain is pure; ports live in `domain/ports/`, adapters in Infrastructure (Electron adapters in `infrastructure/electron/`). Application and Domain never import `electron` or `node:fs`; `scripts/check_layering.mjs` (run by `npm run quality:static`) enforces it. Application may import Infrastructure adapters directly; add a port only for an enforced boundary or a second implementation.
- The Main logger is `electron/core/infrastructure/logging/logger.ts`; `electron/diagnostics.ts` only holds hardware/Ollama probes; Application reaches them through `HardwareProbePort` (adapter `electron/core/infrastructure/diagnostics/hardwareProbe.ts`), enforced by `scripts/check_layering.mjs`.
- `electron/core/infrastructure/http/sidecarHttpClient.ts` centralizes HTTP I/O to `:8000` and sends the per-launch `X-OnlyRag-Token` that `sidecarProcessManager` passes to the Sidecar; only `/health` is exempt.
- Ollama HTTP from Main goes through `electron/core/infrastructure/http/ollamaTransport.ts` (http or https per configured host); defaults live in `shared/domain/ollamaHost.ts` and `shared/domain/settings/appSettingsDefaults.ts`.
- Sidecar vectors record their `embedding_model` per chunk; search embeds the query once per stored model.
- Main Ollama generation uses `ollamaGenerationScheduler` at concurrency 1; model inventory uses `/api/tags`.
- Coding Agent uses only `/api/chat` with native tool calls (no text tool protocol) and an append-only persisted transcript (system prompt frozen per session, the conversation's first task once, turn context appended; a follow-up run keeps the transcript and appends its request); Main executes each call through the security gates and returns every outcome as the tool message. Runs edit the workspace in place and save a restorable checkpoint in `.onlyrag/checkpoints` (`agent:restore-checkpoint`). Sampling follows the Modelfile unless `modelSamplingOverrides` is set. The 2026-09-26 audit is `docs/coding-agent-audit-2026-09-26.md`; qwen3-coder:30b verified the full task (8/8), the qwen3.8:27b rerun is pending (`PROJECT_STATUS.json`).
- The UI terminal and agent shell tools use `PersistentPowerShellSession`; sessions retain shell state per workspace and are disposed with active tasks.

## Repository specifics

- Sidecar lifecycle is owned by `sidecarProcessManager`; on Windows orphan port reclaim requires exact process identity from `sidecar-ownership.json`.
- Keep UTF-8 without BOM and avoid CRLF/LF-only diffs. `.gitattributes` checks every text file out with LF, as Biome requires, whatever `core.autocrlf` says; after a clone made before it existed, `git add --renormalize .` followed by `git reset` clears the phantom modifications.
- A test outside the `dom` project that needs a DOM declares `// @vitest-environment happy-dom` on its first line.
- `PROJECT_STATUS.json` is the canonical backlog; retain its `todos` string-array format and remove completed entries.
- Work directly on `master`; do not create branches. Commit only when explicitly requested; push only when explicitly requested.
