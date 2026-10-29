---
name: onlyrag-workspace-guidelines
description: Change OnlyRag IPC boundaries or persistent document, settings, and chat state while preserving ownership and write acknowledgement.
triggers: ["ipc contract", "electron preload", "settings persistence", "document recovery", "active-store", "chat drafts"]
tags: ["electron main", "state recovery"]
---

# IPC and persistent state

- Change IPC arguments in `shared/ipc/ipcContract.ts`, Preload in `electron/preload.ts`, and the affected handler under `electron/core/presentation/` together. Keep Sidecar HTTP in `electron/core/infrastructure/http/sidecarHttpClient.ts`; the static gate checks registration and layer boundaries.
- For renderer settings bootstrap, retain `appSettingsRepository.loadSettingsOrThrow`: unreadable or unsupported settings must not appear to be a first launch. Its internal `loadSettings` convenience reader catches errors; do not substitute it in a write-enabling bootstrap.
- Preserve acknowledged writes before close in `src/hooks/useSettingsPersistence.ts`. Failed persistence must keep the unsaved state and recovery choices visible.
- Recover `data/document-recovery.json` before database access. Keep the SQLite lease and reject an invalid `data/active-store.json` manifest.
- Retain originals and extraction manifests in `data/source-documents/<doc_id>` with their document, chunk and revision identity. Never classify them as scratch output.
- Keep `expectedRevision`/`expected_revision` across IPC and REST for document writes. A stale draft remains a conflict after a list refresh; do not silently rebase it onto a newer document.
- Keep chat/session journals separate from canonical history; a failed read or save must retain the recoverable revision. Use `electron/core/infrastructure/filesystem/sessionHistoryRecoveryJournal.ts` and the corresponding application service when changing this boundary.
- Check affected IPC, settings and persistence tests using [verification commands](../code-quality-and-linting/SKILL.md). See [architecture.md](../../docs/architecture.md), [retrieval.md](../../docs/retrieval.md), and [agent recovery](../onlyrag-agent-recovery/SKILL.md) for their separate ownership rules.
