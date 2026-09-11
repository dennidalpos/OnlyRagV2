# Contratto IPC

Il Preload espone le funzioni in [`electron/preload.ts`](../electron/preload.ts). I 95 canali request/response sono registrati nei file Presentation; gli argomenti reali sono la firma del Preload e i tipi in [`shared/types/index.ts`](../shared/types/index.ts).

## Canali request/response

| Prefisso | Canali registrati |
| --- | --- |
| `agent` | `approval-response`, `cancel-task`, `export-ai-debug-bundle`, `get-plan-state`, `get-queue-status`, `logs-analyze`, `parse-tool-call`, `plan-enrich-prompt`, `plan-generate`, `plan-interview`, `plan-seed`, `start-task` |
| `artifacts` | `delete`, `get`, `list`, `save` |
| `diagnostics` | `clear-logs`, `get-http-metrics`, `get-log-filepath`, `get-logs`, `log-telemetry`, `open-logs-folder`, `run` |
| `dialog` | `open-directory`, `open-file` |
| `history` | `index`, `search` |
| `ingest` | `delete`, `export`, `file`, `list`, `page-preview`, `search`, `translate-inplace`, `update` |
| `ollama` | `benchmark-model`, `cancel-pull`, `cancel-stream`, `check-model-updates`, `delete-model`, `generate-stream`, `get-model-metrics`, `get-running-models`, `install-or-launch`, `pull-model`, `test-connection`, `unload-model` |
| `projects` | `list`, `migrate-legacy`, `register`, `remove`, `rename`, `touch` |
| `sessions` | `clear`, `delete`, `list`, `migrate-legacy`, `save` |
| `settings` | `get`, `save` |
| `sidecar` | `restart`, `status` |
| `skills` | `add-custom-source`, `get-hub-skill-content`, `install-from-hub`, `install-from-url`, `list-hub-all`, `list-hub-by-source`, `list-installed`, `list-sources`, `remove-custom-source`, `reset-original`, `save-custom`, `toggle-active`, `uninstall` |
| `system` | `check-disk-space`, `open-external`, `open-path` |
| `task` | `cancel`, `clean-residuals` |
| `workspace` | `download-file`, `execute-powershell`, `fetch-web`, `get-git-status-and-diff`, `get-project-map`, `git-commit`, `grep-search`, `init-git`, `inspect-guest-os`, `list-files`, `multi-replace-chunks`, `read-file`, `replace-chunk`, `search-web`, `write-file` |

Registrazione: [`agentIpc.ts`](../electron/core/presentation/agentIpc.ts), [`workspaceIpc.ts`](../electron/core/presentation/workspaceIpc.ts), [`ollamaIpc.ts`](../electron/core/presentation/ollamaIpc.ts), [`sidecarIpc.ts`](../electron/core/presentation/sidecarIpc.ts), [`skillIpc.ts`](../electron/core/presentation/skillIpc.ts), [`settingsIpc.ts`](../electron/core/presentation/settingsIpc.ts), [`diagnosticsIpc.ts`](../electron/core/presentation/diagnosticsIpc.ts), [`systemIpc.ts`](../electron/core/presentation/systemIpc.ts), [`projectRegistryIpc.ts`](../electron/core/presentation/projectRegistryIpc.ts), [`sessionHistoryIpc.ts`](../electron/core/presentation/sessionHistoryIpc.ts), [`artifactIpc.ts`](../electron/core/presentation/artifactIpc.ts).

## Eventi Renderer

Eventi `on` esposti: `agent:approval-request`, `agent:change-metrics`, `agent:done`, `agent:log`, `agent:skill-install-request`, `agent:skills-matched`, `agent:step-update`, `agent:stream-thought`, `agent:stream-token`, `ingest:document-deleted`, `ingest:stream-progress`, `ingest:translate-progress`, `ollama:chunk`, `ollama:pull-progress`, `workspace:file-deleted`.

L'unico `send` Renderer→Main è `agent:skill-install-response`. I listener restituiscono una funzione di unsubscribe.
