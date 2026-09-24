# AGENTS.md

`v1.11 · 2026-09-24` — Repository facts and verified commands.

## Scope

- Local desktop AI assistant and coding studio with RAG, Ollama, and Python Sidecar. Cloud LLM forwarding and proprietary remote services are out of scope.
- Keep Renderer and Main isolated; share only through `shared/`. CPU offload is acceptable when needed for correctness; retain OOM, timeout, anomaly, loop, and eviction safeguards.

## Verified commands

Run from repository root in PowerShell. The Electron, cold-start, settings-bootstrap and bundle-ux E2E commands, the fast suite, Sidecar tests and static checks were rerun on 2026-09-24; `npm run test:live` (10/11 agent scenarios passed; the full task run does not yet close `verified` (2026-09-24 reruns 9/11 and 0/9), tracked as FULLTASK-BEHAVIORAL-CLOSURE-01; with `gpt-oss:20b` it stops at plan generation, tracked as GPTOSS-PLAN-JSON-01; `gptOssThinking.live.ts` 3/3 with `gpt-oss:20b`) were run on 2026-09-23.

| Purpose | Command |
| --- | --- |
| Fast suite | `npm run test:fast` (268 files, 2098 tests; `node` project for `electron/`, `shared/`, `src/services/`, `src/constants/`, `scripts/`, `dom` project for the rest of `src/`) |
| Sidecar tests | `.venv\Scripts\python.exe -m pytest -q` (148 tests) |
| Electron Agent E2E | `npm run test:e2e:electron` (8 reliability + 4 guard scenarios) |
| Sidecar ownership E2E | `npm run test:e2e:sidecar-ownership` (2 tests; requires free `:8000` and built `sidecar.exe`) |
| Cold-start network E2E | `npm run test:e2e:cold-start` (Main and Renderer first launch) |
| Settings bootstrap E2E | `npm run test:e2e:settings-bootstrap` |
| Bundle and viewport E2E | `npm run test:e2e:bundle-ux` (1024×700 and 1400×900) |
| Static quality | `npm run quality:static` (Biome lint errors, format-check of every file, IPC and layering guards; `npx biome lint` lists the `noExplicitAny` warnings) |
| Installer | `npm run package:win` (output in `release/`; Vite owns and empties `dist/`) |
| Full audit | `powershell -ExecutionPolicy Bypass -File ./scripts/audit_codebase.ps1 -Fast` |
| Targeted Vitest | `npx vitest run <path>` |
| Format / types | `npm run format:check`; `npm run typecheck` (includes `scripts/live` and `scripts/e2e`) |
| Dead code / cycles | `npm run audit:deadcode`; `npm run audit:cycles` |

## Architecture

- `src/` (Renderer) and `electron/` (Main) import shared code only from `shared/`.
- Main layers: `electron/core/{presentation,application,domain,infrastructure}`. Domain is pure; ports live in `domain/ports/`, adapters in Infrastructure (Electron adapters in `infrastructure/electron/`). Application and Domain never import `electron` or `node:fs`; `scripts/check_layering.mjs` (run by `npm run quality:static`) enforces it.
- The Main logger is `electron/core/infrastructure/logging/logger.ts`; `electron/diagnostics.ts` only holds hardware/Ollama probes and the diagnostics report; Application reaches them through `HardwareProbePort` (adapter `electron/core/infrastructure/diagnostics/hardwareProbe.ts`), enforced by `scripts/check_layering.mjs`.
- `electron/core/infrastructure/http/sidecarHttpClient.ts` centralizes HTTP I/O to `:8000` and sends the per-launch `X-OnlyRag-Token` that `sidecarProcessManager` passes to the Sidecar; only `/health` is exempt.
- Ollama HTTP from Main goes through `electron/core/infrastructure/http/ollamaTransport.ts` (http or https per configured host); defaults live in `shared/domain/ollamaHost.ts` and `shared/domain/settings/appSettingsDefaults.ts`.
- Sidecar vectors record their `embedding_model` per chunk; search embeds the query once per stored model.
- Main Ollama generation uses `ollamaGenerationScheduler` at concurrency 1; model inventory uses `/api/tags`.

## Repository specifics

- Sidecar lifecycle is owned by `sidecarProcessManager`; on Windows orphan port reclaim requires exact process identity from `sidecar-ownership.json`.
- Keep UTF-8 without BOM and avoid CRLF/LF-only diffs.
- A test outside the `dom` project that needs a DOM declares `// @vitest-environment happy-dom` on its first line.
- `PROJECT_STATUS.json` is the canonical backlog; retain its `todos` string-array format and remove completed entries.
- Work directly on `master`; do not create branches. Commit only when explicitly requested; push only when explicitly requested.
