---
name: onlyrag-workspace-guidelines
description: Repository architecture, state-safety and verification boundaries for OnlyRag V2 changes.
---

# OnlyRag V2 workspace

- Renderer (`src/`) and Main (`electron/`) share code only through `shared/`.
- Main layers are Presentation, Application, Domain and Infrastructure under `electron/core/`. Domain has no I/O.
- Renderer accesses privileged functions only through `window.electronAPI` in `electron/preload.ts`; IPC handlers live in `electron/core/presentation/`.
- `sidecar/main.py` and `sidecar/schemas.py` define the local FastAPI contract. Main HTTP access goes through `sidecarHttpClient.ts`.
- Ollama generation is serialized by `ollamaGenerationScheduler`; resolve installed models from `/api/tags`.
- Agent project runs use disposable workspaces. Keep filesystem, shell, network, installation, publish and commit approvals inside their existing guards.
- Keep the selected model, runtime digest, budgets and `num_ctx` stable within an agent run; compact prompt content rather than shrinking the runtime window.
- Planning confirms the ledger before proposing candidates and binds review references. Keep raw prompt history; do not reintroduce a legacy transcript rewrite.

## Persistent state and retained data

- Only `ENOENT` means absent state. Malformed, unreadable or unsupported state blocks dependent writes; do not replace it with empty/default data.
- Recover `data/document-recovery.json` before database access. On failed recovery, preserve the record and block database access.
- The database owns its SQLite lease. An invalid active-store manifest blocks startup; do not fall back to a legacy store or reclaim another process by name.
- Source originals and extraction manifests under `data/source-documents/<doc_id>` are retained evidence, not disposable scratch data. Preserve document/chunk/revision identity; do not auto-clean or migrate archives.
- Keep filesystem path gates, checkpoints, cancellation preservation, retry/timeout and OOM guards. Empty paths and basename fallbacks are invalid.

## Model and verification boundaries

- Ingestion Vision OCR and optional normalization share `num_ctx`; insufficient context preserves the original and leaves it unindexed.
- Local Ollama and Sidecar tests provide deterministic evidence only. Do not claim model, live-network, power-loss or interactive UX qualification without the corresponding isolated live evidence.
- Use the smallest relevant command from `docs/operations.md`: `npm run test:fast -- --silent=true`, `.venv\Scripts\python.exe -m pytest -q`, `npm run typecheck`, `npm run quality:static`, or `npm run build`. Regenerate OpenAPI with `npm run generate:openapi` after REST schema changes.
- Non-DOM Vitest tests needing browser APIs declare `// @vitest-environment happy-dom`. Test-only exports use `@internal`.

## Release and maintenance

- `npm ci` on this Windows/Node 24/npm 11 setup still requires `node node_modules/electron/install.js` before Electron smoke or E2E checks.
- Use `npm run package:win` for CPU release candidates. It creates a new `release/cpu-*` child and refuses `-SkipSidecar`; an installer alone does not qualify source, notice or publishing gates.
- Cleanup requires reviewed literal `-DisposablePaths` and `-WhatIf` first. Never classify `.onlyrag`, `userdata_dev`, `Desktop/test_app`, configured `ONLYRAG_LIVE_ROOT`, recovery/checkpoint files or retained evidence as disposable from name matching.

Use `docs/README.md` for the documentation map, `electron/preload.ts` for IPC, and `sidecar/main.py` for REST. Verify with the commands in `docs/operations.md`.
