/**
 * Strongly-Typed IPC Channel Name Registry for OnlyRag V2
 * Centralized mapping of all Electron Main <-> Renderer IPC communication channels.
 */
export const IPC_CHANNELS = {
  DIAGNOSTICS: {
    RUN: 'diagnostics:run',
    GET_LOGS: 'diagnostics:get-logs',
    CLEAR_LOGS: 'diagnostics:clear-logs',
    GET_LOG_FILEPATH: 'diagnostics:get-log-filepath',
    LOG_TELEMETRY: 'diagnostics:log-telemetry',
  },
  OLLAMA: {
    PULL: 'ollama:pull',
    DELETE: 'ollama:delete',
    INSTALL_OR_LAUNCH: 'ollama:install-or-launch',
    GENERATE_STREAM: 'ollama:generate-stream',
    CANCEL_STREAM: 'ollama:cancel-stream',
  },
  SIDECAR: {
    STATUS: 'sidecar:status',
    RESTART: 'sidecar:restart',
    INGEST: 'sidecar:ingest',
    GET_DOCUMENTS: 'sidecar:get-documents',
    DELETE_DOCUMENT: 'sidecar:delete-document',
    SEARCH_VECTOR: 'sidecar:search-vector',
    EXPORT_DOC: 'sidecar:export-doc',
  },
  WORKSPACE: {
    LIST_FILES: 'workspace:list-files',
    GET_PROJECT_MAP: 'workspace:get-project-map',
    READ_FILE: 'workspace:read-file',
    WRITE_FILE: 'workspace:write-file',
    EXECUTE_POWERSHELL: 'workspace:execute-powershell',
  },
  DIALOG: {
    OPEN_FILE: 'dialog:open-file',
    OPEN_DIRECTORY: 'dialog:open-directory',
  },
  TASK: {
    CANCEL: 'task:cancel',
    CLEAN_RESIDUALS: 'task:clean-residuals',
  },
} as const

export type IpcChannelCategory = keyof typeof IPC_CHANNELS
