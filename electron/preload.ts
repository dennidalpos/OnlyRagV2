import { contextBridge, ipcRenderer } from 'electron'
import type { IElectronAPI } from '../src/types'

const api: IElectronAPI = {
  runDiagnostics: () => ipcRenderer.invoke('diagnostics:run'),
  getLogs: () => ipcRenderer.invoke('diagnostics:get-logs'),
  clearLogs: () => ipcRenderer.invoke('diagnostics:clear-logs'),
  getLogFilePath: () => ipcRenderer.invoke('diagnostics:get-log-filepath'),
  openLogsFolder: () => ipcRenderer.invoke('diagnostics:open-logs-folder'),
  logTelemetry: (level, category, message) => ipcRenderer.invoke('diagnostics:log-telemetry', level, category, message),
  pullOllamaModel: (modelName: string) => ipcRenderer.invoke('ollama:pull-model', modelName),
  cancelPullOllamaModel: () => ipcRenderer.invoke('ollama:cancel-pull'),
  deleteOllamaModel: (modelName: string) => ipcRenderer.invoke('ollama:delete-model', modelName),
  installOrLaunchOllama: () => ipcRenderer.invoke('ollama:install-or-launch'),
  getSidecarStatus: () => ipcRenderer.invoke('sidecar:status'),
  restartSidecar: () => ipcRenderer.invoke('sidecar:restart'),
  openFileDialog: (options) => ipcRenderer.invoke('dialog:open-file', options),
  openDirectoryDialog: (options) => ipcRenderer.invoke('dialog:open-directory', options),
  ingestFile: (filePath: string) => ipcRenderer.invoke('ingest:file', filePath),
  updateIngestedDocument: (docId: string, markdownContent: string) => ipcRenderer.invoke('ingest:update', docId, markdownContent),
  getDocumentPagePreview: (docId: string, pageNumber: number) => ipcRenderer.invoke('ingest:page-preview', docId, pageNumber),
  getIngestedDocuments: () => ipcRenderer.invoke('ingest:list'),
  deleteIngestedDocument: (docId: string) => ipcRenderer.invoke('ingest:delete', docId),
  searchVectorDb: (query: string, topK?: number, embeddingModel?: string, docIds?: string[]) =>
    ipcRenderer.invoke('ingest:search', query, topK, embeddingModel, docIds),
  exportDocument: (markdownContent: string, format: string) => ipcRenderer.invoke('ingest:export', markdownContent, format),
  generateOllamaStream: async (model: string, prompt: string, onChunk: (chunk: string) => void, options?: any) => {
    const chunkListener = (_: any, chunk: string) => onChunk(chunk)
    ipcRenderer.on('ollama:chunk', chunkListener)
    try {
      await ipcRenderer.invoke('ollama:generate-stream', model, prompt, options)
    } finally {
      ipcRenderer.removeListener('ollama:chunk', chunkListener)
    }
  },
  cancelOllamaStream: () => ipcRenderer.invoke('ollama:cancel-stream'),
  cancelTask: (taskId?: string) => ipcRenderer.invoke('task:cancel', taskId),
  cleanTempResiduals: () => ipcRenderer.invoke('task:clean-residuals'),
  listWorkspaceFiles: (dirPath?: string) => ipcRenderer.invoke('workspace:list-files', dirPath),
  getProjectMap: (dirPath: string) => ipcRenderer.invoke('workspace:get-project-map', dirPath),
  readWorkspaceFile: (filePath: string, startLine?: number, endLine?: number) => ipcRenderer.invoke('workspace:read-file', filePath, startLine, endLine),
  writeWorkspaceFile: (filePath: string, content: string) => ipcRenderer.invoke('workspace:write-file', filePath, content),
  deleteWorkspaceFile: (filePath: string) => ipcRenderer.invoke('workspace:delete-file', filePath),
  replaceWorkspaceFileChunk: (filePath: string, targetContent: string, replacementContent: string) =>
    ipcRenderer.invoke('workspace:replace-chunk', filePath, targetContent, replacementContent),
  multiReplaceWorkspaceFileChunks: (filePath: string, replacements: any[]) =>
    ipcRenderer.invoke('workspace:multi-replace-chunks', filePath, replacements),
  grepWorkspaceFiles: (dirPath: string, query: string, isRegex?: boolean, caseInsensitive?: boolean) =>
    ipcRenderer.invoke('workspace:grep-search', dirPath, query, isRegex, caseInsensitive),
  searchWeb: (query: string, maxResults?: number) => ipcRenderer.invoke('workspace:search-web', query, maxResults),
  fetchWebContent: (url: string, maxChars?: number) => ipcRenderer.invoke('workspace:fetch-web', url, maxChars),
  downloadFile: (url: string, targetFilePath: string) => ipcRenderer.invoke('workspace:download-file', url, targetFilePath),
  inspectGuestOsEnvironment: () => ipcRenderer.invoke('workspace:inspect-guest-os'),
  executePowerShellCommand: (command: string, cwd?: string, timeoutMs?: number) => ipcRenderer.invoke('workspace:execute-powershell', command, cwd, timeoutMs),
  parseAgentToolCall: (rawText: string) => ipcRenderer.invoke('agent:parse-tool-call', rawText),
  checkDiskSpace: (models: string[]) => ipcRenderer.invoke('system:check-disk-space', models),
  applyOllamaEnvironmentVariables: (variables: { name: string; value: string }[], restartOllama?: boolean) =>
    ipcRenderer.invoke('system:apply-env-vars', variables, restartOllama),
  openExternalUrl: (url: string) => ipcRenderer.invoke('system:open-external', url),
  startAgentTask: (payload: any) => ipcRenderer.invoke('agent:start-task', payload),
  cancelAgentTask: (taskId?: string) => ipcRenderer.invoke('agent:cancel-task', taskId),
  getAgentQueueStatus: () => ipcRenderer.invoke('agent:get-queue-status'),
  setAgentMaxConcurrency: (limit: number) => ipcRenderer.invoke('agent:set-max-concurrency', limit),
  deleteAgentSession: (sessionId: string, workspacePath?: string | null) => ipcRenderer.invoke('agent:delete-session', sessionId, workspacePath),
  clearAllAgentSessions: (workspacePath?: string | null) => ipcRenderer.invoke('agent:clear-all-sessions', workspacePath),
  clearCodingAgentAuditLog: () => ipcRenderer.invoke('agent:clear-audit-log'),
  onAgentLog: (callback: (log: any) => void) => {
    const subscription = (_: any, log: any) => callback(log)
    ipcRenderer.on('agent:log', subscription)
    return () => ipcRenderer.removeListener('agent:log', subscription)
  },
  onAgentStepUpdate: (callback: (data: { step: number; maxSteps: number; maxStepsLabel: string; statusText?: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('agent:step-update', subscription)
    return () => ipcRenderer.removeListener('agent:step-update', subscription)
  },
  onAgentStreamToken: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('agent:stream-token', subscription)
    return () => ipcRenderer.removeListener('agent:stream-token', subscription)
  },
  onAgentDone: (callback: (res: any) => void) => {
    const subscription = (_: any, res: any) => callback(res)
    ipcRenderer.on('agent:done', subscription)
    return () => ipcRenderer.removeListener('agent:done', subscription)
  },
  onAgentApprovalRequest: (callback: (req: any) => void) => {
    const subscription = (_: any, req: any) => callback(req)
    ipcRenderer.on('agent:approval-request', subscription)
    return () => ipcRenderer.removeListener('agent:approval-request', subscription)
  },
  onAgentSkillsMatched: (callback: (data: { skills: string[] }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('agent:skills-matched', subscription)
    return () => ipcRenderer.removeListener('agent:skills-matched', subscription)
  },
  onWorkspaceFileDeleted: (callback: (data: { filePath: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('workspace:file-deleted', subscription)
    return () => ipcRenderer.removeListener('workspace:file-deleted', subscription)
  },
  onIngestDocumentDeleted: (callback: (data: { docId: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('ingest:document-deleted', subscription)
    return () => ipcRenderer.removeListener('ingest:document-deleted', subscription)
  },
  onIngestStreamProgress: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('ingest:stream-progress', subscription)
    return () => ipcRenderer.removeListener('ingest:stream-progress', subscription)
  },
  onOllamaPullProgress: (callback: (data: { modelName: string; status: string; completed?: number; total?: number }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('ollama:pull-progress', subscription)
    return () => ipcRenderer.removeListener('ollama:pull-progress', subscription)
  },
  benchmarkModel: (modelName: string) => ipcRenderer.invoke('ollama:benchmark-model', modelName),
  getRunningModels: (host?: string) => ipcRenderer.invoke('ollama:get-running-models', host),
  unloadModel: (modelName: string, host?: string) => ipcRenderer.invoke('ollama:unload-model', modelName, host),
  listInstalledSkills: (workspaceRoot?: string) => ipcRenderer.invoke('skills:list-installed', workspaceRoot),
  listHubSkills: (workspaceRoot?: string) => ipcRenderer.invoke('skills:list-hub', workspaceRoot),
  listHubSources: () => ipcRenderer.invoke('skills:list-sources'),
  addCustomHubSource: (input: any) => ipcRenderer.invoke('skills:add-custom-source', input),
  removeCustomHubSource: (sourceId: string) => ipcRenderer.invoke('skills:remove-custom-source', sourceId),
  listHubSkillsBySource: (sourceId: string, workspaceRoot?: string, forceRefresh?: boolean) => ipcRenderer.invoke('skills:list-hub-by-source', sourceId, workspaceRoot, forceRefresh),
  toggleSkillActive: (skillId: string, isActive: boolean) => ipcRenderer.invoke('skills:toggle-active', skillId, isActive),
  installSkillFromHub: (hubSkillId: string, workspaceRoot?: string, hubSourceId?: string) => ipcRenderer.invoke('skills:install-from-hub', hubSkillId, workspaceRoot, hubSourceId),
  installSkillFromUrl: (url: string, workspaceRoot?: string, customName?: string) => ipcRenderer.invoke('skills:install-from-url', url, workspaceRoot, customName),
  saveCustomSkill: (input: any, workspaceRoot?: string) => ipcRenderer.invoke('skills:save-custom', input, workspaceRoot),
  resetSkillToOriginal: (skillId: string, workspaceRoot?: string) => ipcRenderer.invoke('skills:reset-original', skillId, workspaceRoot),
  uninstallSkill: (skillId: string, workspaceRoot?: string) => ipcRenderer.invoke('skills:uninstall', skillId, workspaceRoot),
  /** SLM Agent Studio: execute one orchestration turn through the Python sidecar state machine. */
  agentSlmOrchestrate: (request: any) => ipcRenderer.invoke('agent:slm-orchestrate', request),
  /** SLM Agent Studio: trigger log anomaly scan; returns structured diagnostic report. */
  agentLogsAnalyze: (extraPaths?: string[]) => ipcRenderer.invoke('agent:logs-analyze', extraPaths),
}

contextBridge.exposeInMainWorld('electronAPI', api)
