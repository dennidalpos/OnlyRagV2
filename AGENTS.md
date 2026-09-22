# AGENTS.md

`v1.6 · 2026-09-22` — Repository facts and verified commands.

## Scope

- Local desktop AI assistant and coding studio with RAG, Ollama, and Python Sidecar. Cloud LLM forwarding and proprietary remote services are out of scope.
- Keep Renderer and Main isolated; share only through `shared/`. CPU offload is acceptable when needed for correctness; retain OOM, timeout, anomaly, loop, and eviction safeguards.

## Verified commands

Run from repository root in PowerShell. The new E2E commands and static checks were run on 2026-09-22.

| Purpose | Command |
| --- | --- |
| Fast suite | `npm run test:fast` (255 files, 1982 tests) |
| Electron Agent E2E | `npm run test:e2e:electron` (8 scenarios; 2026-09-21) |
| Sidecar ownership E2E | `npm run test:e2e:sidecar-ownership` (2 tests; requires free `:8000` and built `sidecar.exe`) |
| Renderer network E2E | `npm run test:e2e:cold-start` (Renderer remount only) |
| Bundle and viewport E2E | `npm run test:e2e:bundle-ux` (1024×700 and 1400×900) |
| Static quality | `npm run quality:static` |
| Full audit | `powershell -ExecutionPolicy Bypass -File ./scripts/audit_codebase.ps1 -Fast` |
| Targeted Vitest | `npx vitest run <path>` |
| Format / types | `npm run format:check`; `npm run typecheck` |
| Dead code / cycles | `npm run audit:deadcode`; `npm run audit:cycles` |

## Architecture

- `src/` (Renderer) and `electron/` (Main) import shared code only from `shared/`.
- Main layers: `electron/core/{presentation,application,domain,infrastructure}`. Domain is pure; ports live in Domain, adapters in Infrastructure.
- `electron/core/infrastructure/http/sidecarHttpClient.ts` centralizes HTTP I/O to `:8000`.
- Main Ollama generation uses `ollamaGenerationScheduler` at concurrency 1; model inventory uses `/api/tags`.

## Repository specifics

- Sidecar lifecycle is owned by `sidecarProcessManager`; on Windows orphan port reclaim requires exact process identity from `sidecar-ownership.json`.
- Keep UTF-8 without BOM and avoid CRLF/LF-only diffs.
- `PROJECT_STATUS.json` is the canonical backlog; retain its `todos` string-array format and remove completed entries.
- Work directly on `master`; do not create branches. Commit only when explicitly requested; push only when explicitly requested.
