# AGENTS.md

`v1.3 · 2026-09-03` — Non-derivable repository facts only. Cap ~2500 characters.

## 1. Identity & Scope
- **Purpose**: Local desktop AI assistant and agentic coding studio with RAG, Ollama runtime, and Python sidecar.
- **Runtime / Toolchain**: Node.js 22 (npm) | Electron 35 | TypeScript 5.8 | Vite 6 | Python 3.12 (sidecar). Windows pwsh.
- **Out of Scope**: Cloud LLM API forwarding; non-local proprietary services.
- **Hard Constraints**: Zero VRAM thrashing (pinned workhorse model); strict process isolation (Renderer/Main share only via `shared/`).

## 2. Verified Commands
Executed and verified in session. Date: 2026-09-03.

| Workflow | Command | Shell / Cwd | Notes / Examples |
| :--- | :--- | :--- | :--- |
| **Fast Verification** | `npm run test:fast` | pwsh / root | Vitest fast suite (212 files, 1811 tests) |
| **Full Verification** | `powershell -ExecutionPolicy Bypass -File ./scripts/audit_codebase.ps1 -Fast` | pwsh / root | Full audit (types, tests, cycles, deadcode) |
| **Single Target** | `npx vitest run <path>` | pwsh / root | e.g. `npx vitest run electron/core/application/systemAppService.test.ts` |
| **Format Check** | `npm run format:check` | pwsh / root | Git diff whitespace & conflict marker check |
| **Type Check** | `npm run typecheck` | pwsh / root | TypeScript `tsc --noEmit` across main, preload, renderer |
| **Deadcode Audit** | `npm run audit:deadcode` | pwsh / root | Knip unused dependencies and exports audit |
| **Cycles Audit** | `npm run audit:cycles` | pwsh / root | Skott & dpdm cycle detection (0 cycles) |


## 3. Architecture & Boundaries
- **Process Isolation**: `src/` (Renderer) and `electron/` (Main) share code ONLY via `shared/` (`shared/types`, `shared/domain/`). Zero imports from `src/` in `electron/`; zero imports from `electron/` in `src/`.
- **Main Clean Layers**: `electron/core/{presentation,application,domain,infrastructure}`. Domain is pure and independent of Infrastructure (ports in Domain, adapters in Infrastructure).
- **Sidecar Transport**: `electron/core/infrastructure/http/sidecarHttpClient.ts` centralizes all HTTP I/O to `:8000`.
- **Ollama Transport**: `electron/core/infrastructure/http/ollamaHttpClient.ts` with unified `/api/tags` data path.

## 4. Sensitive Areas & Gotchas
- **Sidecar Port :8000**: Process lifecycle owned by `sidecarProcessManager` via orphan port reclaim.
- **Line Endings**: Windows CRLF/LF conversions must not pollute git diffs. Keep UTF-8 without BOM.
