# AGENTS.md

`v1.5 · 2026-09-07` — Non-derivable repository facts only. Cap ~2500 characters.

## 1. Identity & Scope
- **Purpose**: Local desktop AI assistant and coding studio with RAG, Ollama, and Python sidecar.
- **Out of Scope**: Cloud LLM API forwarding; non-local proprietary services.
- **Hard Constraints**: Strict process isolation (Renderer/Main share only via `shared/`). CPU offload and the resulting latency are acceptable when required for response correctness; retain safeguards against CUDA OOM, timeouts, anomalies, loops, and unsafe eviction.

## 2. Verified Commands
Executed and verified in session. Date: 2026-09-09.

| Workflow | Command | Shell / Cwd | Notes / Examples |
| :--- | :--- | :--- | :--- |
| **Fast Verification** | `npm run test:fast` | pwsh / root | 228 files, 1892 tests |
| **Static Quality** | `npm run quality:static` | pwsh / root | Biome lint all; format-check newly added files |
| **Full Verification** | `powershell -ExecutionPolicy Bypass -File ./scripts/audit_codebase.ps1 -Fast` | pwsh / root | Fail-fast on dependency cycles; known dead-code finding W2.07 |
| **Single Target** | `npx vitest run <path>` | pwsh / root | Vitest target |
| **Format Check** | `npm run format:check` | pwsh / root | Git diff whitespace & conflict marker check |
| **Type Check** | `npm run typecheck` | pwsh / root | TypeScript `tsc --noEmit` across main, preload, renderer |
| **Deadcode Audit** | `npm run audit:deadcode` | pwsh / root | Knip unused dependencies and exports audit |
| **Cycles Audit** | `npm run audit:cycles` | pwsh / root | Zero cycles; exits non-zero when a cycle is detected |


## 3. Architecture & Boundaries
- **Process Isolation**: `src/` (Renderer) and `electron/` (Main) share code ONLY via `shared/` (`shared/types`, `shared/domain/`). Zero imports from `src/` in `electron/`; zero imports from `electron/` in `src/`.
- **Main Clean Layers**: `electron/core/{presentation,application,domain,infrastructure}`. Domain is pure; ports are in Domain, adapters in Infrastructure.
- **Sidecar Transport**: `electron/core/infrastructure/http/sidecarHttpClient.ts` centralizes all HTTP I/O to `:8000`.
- **Ollama Transport**: Unified `/api/tags` path; every Main generation uses `ollamaGenerationScheduler` at concurrency 1.

## 4. Sensitive Areas & Gotchas
- **Sidecar Port :8000**: Process lifecycle owned by `sidecarProcessManager` via orphan port reclaim.
- **Line Endings**: Windows CRLF/LF conversions must not pollute git diffs. Keep UTF-8 without BOM.
- **Development Tracker**: `PROJECT_STATUS.json` is the canonical backlog; keep its `todos` string-array format and preserve existing entries.
- **Git Workflow**: Commit completed, verified changes directly on `master`; do not create branches. Push only when explicitly requested.
