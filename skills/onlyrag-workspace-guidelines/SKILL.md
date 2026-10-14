---
name: onlyrag-workspace-guidelines
description: Change OnlyRag Electron IPC boundaries or persistent document, settings, and agent state while preserving recovery and ownership rules.
triggers: ["ipc contract", "electron preload", "persistent state", "document recovery", "active-store", "agent checkpoint"]
tags: ["electron main", "state recovery"]
---

# IPC and persistent state

- Keep Renderer (`src/`) and Main (`electron/`) connected through typed contracts in `shared/ipc/ipcContract.ts` and `electron/preload.ts`. Register handlers under `electron/core/presentation/`; keep Sidecar HTTP in `electron/core/infrastructure/http/sidecarHttpClient.ts`.
- Treat Main's Domain layer as I/O-free. Preserve state ownership and readback at the Main/Sidecar boundary.
- Treat only `ENOENT` as absent state. Block dependent writes on malformed, unreadable or unsupported state instead of replacing it with defaults.
- Recover `data/document-recovery.json` before database access. Keep the SQLite lease and reject an invalid `data/active-store.json` manifest.
- Retain originals and extraction manifests in `data/source-documents/<doc_id>` with their document, chunk and revision identity. Never classify them as scratch output.
- Check affected IPC, recovery and persistence tests; use `docs/architecture.md` and `docs/rag-sidecar.md` for boundary details.
