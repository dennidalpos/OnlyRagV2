---
name: onlyrag-workspace-guidelines
description: Repository boundaries and operational contracts for OnlyRag V2.
---

# OnlyRag V2 workspace

- Renderer (`src/`) and Main (`electron/`) share code only through `shared/`.
- Main layers are Presentation, Application, Domain and Infrastructure under `electron/core/`. Domain has no I/O.
- Renderer accesses privileged functions only through `window.electronAPI` in `electron/preload.ts`; IPC handlers live in `electron/core/presentation/`.
- `sidecar/main.py` and `sidecar/schemas.py` define the local FastAPI contract. Main HTTP access goes through `sidecarHttpClient.ts`.
- Ollama generation is serialized by `ollamaGenerationScheduler`; resolve installed models from `/api/tags`.
- Agent project runs use disposable workspaces. Keep filesystem, shell, network and publish/commit approvals inside their existing guards.
- Keep the selected `num_ctx` stable within an agent run; compact prompt content rather than shrinking the runtime window.

Use `docs/README.md` for the documentation map, `electron/preload.ts` for IPC, and `sidecar/main.py` for REST. Verify with the commands in `docs/operations.md`.
