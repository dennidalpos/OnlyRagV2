---
name: onlyrag-workspace-guidelines
description: Change OnlyRag Electron IPC boundaries or persistent document, settings, and agent state while preserving recovery and ownership rules.
triggers: ["ipc contract", "electron preload", "persistent state", "document recovery", "active-store", "agent checkpoint"]
tags: ["electron main", "state recovery"]
---

# IPC and persistent state

- Follow the IPC boundary in AGENTS.md; register handlers under `electron/core/presentation/` and keep Sidecar HTTP in `electron/core/infrastructure/http/sidecarHttpClient.ts`. Validate handler registration and layer boundaries with `npm run quality:static`.
- Treat only `ENOENT` as absent state. Block dependent writes on malformed, unreadable or unsupported state instead of replacing it with defaults.
- Recover `data/document-recovery.json` before database access. Keep the SQLite lease and reject an invalid `data/active-store.json` manifest.
- Retain originals and extraction manifests in `data/source-documents/<doc_id>` with their document, chunk and revision identity. Never classify them as scratch output.
- Keep `expectedRevision`/`expected_revision` across IPC and REST for document writes. A stale draft remains a conflict after a list refresh; do not silently rebase it onto a newer document.
- Check affected IPC, recovery and persistence tests; use [architecture.md](../../docs/architecture.md) and [rag-sidecar.md](../../docs/rag-sidecar.md) for boundary details.
