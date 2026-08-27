import { contextBridge, ipcRenderer } from 'electron'
import type { IElectronAPI, AppSettings, CodingSession, PlanMilestone, SkillInstallApprovalRequest, PromptHistoryIndexPayload } from '../src/types'

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
  openFileDialog: (options?: { title?: string; filters?: { name: string; extensions: string[] }[] }) => ipcRenderer.invoke('dialog:open-file', options),
  openDirectoryDialog: (options?: { title?: string }) => ipcRenderer.invoke('dialog:open-directory', options),
  ingestFile: (filePath: string, visionModel?: string, visionPrompt?: string, normalizeWithLlm?: boolean, normalizationModel?: string, numCtx?: number) =>
    ipcRenderer.invoke('ingest:file', filePath, visionModel, visionPrompt, normalizeWithLlm, normalizationModel, numCtx),
  updateIngestedDocument: (docId: string, markdownContent: string) => ipcRenderer.invoke('ingest:update', docId, markdownContent),
  translateDocumentInplace: (docId: string, sourceLang: string, targetLang: string, model?: string, backupOriginal?: boolean, targetDir?: string, numCtx?: number) => ipcRenderer.invoke('ingest:translate-inplace', docId, sourceLang, targetLang, model, backupOriginal, targetDir, numCtx),
  getDocumentPagePreview: (docId: string, pageNumber: number) => ipcRenderer.invoke('ingest:page-preview', docId, pageNumber),
  getIngestedDocuments: () => ipcRenderer.invoke('ingest:list'),
  deleteIngestedDocument: (docId: string) => ipcRenderer.invoke('ingest:delete', docId),
  searchVectorDb: (query: string, topK?: number, embeddingModel?: string, docIds?: string[]) =>
    ipcRenderer.invoke('ingest:search', query, topK, embeddingModel, docIds),
  exportDocument: (markdownContent: string, format: string, outputFolder?: string) => ipcRenderer.invoke('ingest:export', markdownContent, format, outputFolder),
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
  replaceWorkspaceFileChunk: (filePath: string, targetContent: string, replacementContent: string) =>
    ipcRenderer.invoke('workspace:replace-chunk', filePath, targetContent, replacementContent),
  multiReplaceWorkspaceFileChunks: (filePath: string, replacements: any[]) =>
    ipcRenderer.invoke('workspace:multi-replace-chunks', filePath, replacements),
  grepWorkspaceFiles: (dirPath: string, query: string, isRegex?: boolean, caseInsensitive?: boolean) =>
    ipcRenderer.invoke('workspace:grep-search', dirPath, query, isRegex, caseInsensitive),
  searchWeb: (query: string, maxResults?: number) => ipcRenderer.invoke('workspace:search-web', query, maxResults),
  fetchWebContent: (url: string, maxChars?: number) => ipcRenderer.invoke('workspace:fetch-web', url, maxChars),
  downloadFile: (url: string, targetFilePath: string) => ipcRenderer.invoke('workspace:download-file', url, targetFilePath),
  gitCommit: (commitMessage: string, workspaceRoot?: string) => ipcRenderer.invoke('workspace:git-commit', commitMessage, workspaceRoot),
  getGitStatusAndDiff: (workspaceRoot?: string) => ipcRenderer.invoke('workspace:get-git-status-and-diff', workspaceRoot),
  initGitRepository: (workspaceRoot?: string) => ipcRenderer.invoke('workspace:init-git', workspaceRoot),
  inspectGuestOsEnvironment: () => ipcRenderer.invoke('workspace:inspect-guest-os'),
  executePowerShellCommand: (command: string, cwd?: string, timeoutMs?: number) => ipcRenderer.invoke('workspace:execute-powershell', command, cwd, timeoutMs),
  parseAgentToolCall: (rawText: string) => ipcRenderer.invoke('agent:parse-tool-call', rawText),
  checkDiskSpace: (models: string[]) => ipcRenderer.invoke('system:check-disk-space', models),
  testOllamaConnection: (host?: string) => ipcRenderer.invoke('ollama:test-connection', host),
  getOllamaModelMetrics: (host?: string) => ipcRenderer.invoke('ollama:get-model-metrics', host),
  getHttpMetrics: () => ipcRenderer.invoke('diagnostics:get-http-metrics'),
  checkOllamaModelUpdates: (host?: string) => ipcRenderer.invoke('ollama:check-model-updates', host),
  openExternalUrl: (url: string) => ipcRenderer.invoke('system:open-external', url),
  openPath: (targetPath: string) => ipcRenderer.invoke('system:open-path', targetPath),
  startAgentTask: (payload: any) => ipcRenderer.invoke('agent:start-task', payload),
  cancelAgentTask: (taskId?: string) => ipcRenderer.invoke('agent:cancel-task', taskId),
  respondToAgentApproval: (sessionId: string, approved: boolean, approvedHunkIndices?: number[]) =>
    ipcRenderer.invoke('agent:approval-response', sessionId, approved, approvedHunkIndices),
  getAgentQueueStatus: () => ipcRenderer.invoke('agent:get-queue-status'),
  /** Session history CRUD (filesystem store, single source of truth). */
  listCodingSessions: (workspacePath?: string | null) => ipcRenderer.invoke('sessions:list', workspacePath),
  saveCodingSession: (session: CodingSession) => ipcRenderer.invoke('sessions:save', session),
  deleteCodingSession: (sessionId: string, workspacePath?: string | null) => ipcRenderer.invoke('sessions:delete', sessionId, workspacePath),
  clearCodingSessions: (workspacePath?: string | null) => ipcRenderer.invoke('sessions:clear', workspacePath),
  /** One-shot import of the legacy localStorage session history. */
  migrateLegacyCodingSessions: (sessions: unknown) => ipcRenderer.invoke('sessions:migrate-legacy', sessions),
  /** Main-process-owned project registry (filesystem store, see projectRegistryRepository). */
  listProjects: () => ipcRenderer.invoke('projects:list'),
  registerProject: (projectPath: string, name?: string) => ipcRenderer.invoke('projects:register', projectPath, name),
  touchProject: (projectPath: string) => ipcRenderer.invoke('projects:touch', projectPath),
  renameProject: (projectPath: string, name: string) => ipcRenderer.invoke('projects:rename', projectPath, name),
  removeProjectFromRegistry: (projectPath: string) => ipcRenderer.invoke('projects:remove', projectPath),
  /** One-shot import of the legacy localStorage project list. */
  migrateLegacyProjects: (projects: unknown) => ipcRenderer.invoke('projects:migrate-legacy', projects),
  /** Unified filesystem settings store (settings.json under userData). */
  getAppSettings: () => ipcRenderer.invoke('settings:get'),
  saveAppSettings: (settings: AppSettings) => ipcRenderer.invoke('settings:save', settings),
  /** Cross-project semantic prompt history (see sidecar's /history/* routes). */
  indexPromptHistory: (payload: PromptHistoryIndexPayload) => ipcRenderer.invoke('history:index', payload),
  searchPromptHistory: (query: string, topK?: number, projectPaths?: string[]) => ipcRenderer.invoke('history:search', query, topK, projectPaths),
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
  /** Aggregate size of the file changes applied so far in the active agent session. */
  onAgentChangeMetrics: (callback: (data: { filesTouched: number; additions: number; deletions: number }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('agent:change-metrics', subscription)
    return () => ipcRenderer.removeListener('agent:change-metrics', subscription)
  },
  onAgentStreamToken: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('agent:stream-token', subscription)
    return () => ipcRenderer.removeListener('agent:stream-token', subscription)
  },
  onAgentStreamThought: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('agent:stream-thought', subscription)
    return () => ipcRenderer.removeListener('agent:stream-thought', subscription)
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
  /** Skill Hub 'prompt' policy: install request raised while the turn prompt is assembled. */
  onAgentSkillInstallRequest: (callback: (req: SkillInstallApprovalRequest) => void) => {
    const subscription = (_: any, req: SkillInstallApprovalRequest) => callback(req)
    ipcRenderer.on('agent:skill-install-request', subscription)
    return () => ipcRenderer.removeListener('agent:skill-install-request', subscription)
  },
  /** Skill Hub 'prompt' policy: user's answer to a pending install request. */
  respondAgentSkillInstall: (requestId: string, approved: boolean) => {
    ipcRenderer.send('agent:skill-install-response', { requestId, approved })
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
  onTranslateProgress: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('ingest:translate-progress', subscription)
    return () => ipcRenderer.removeListener('ingest:translate-progress', subscription)
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
  listHubSources: () => ipcRenderer.invoke('skills:list-sources'),
  addCustomHubSource: (input: any) => ipcRenderer.invoke('skills:add-custom-source', input),
  removeCustomHubSource: (sourceId: string) => ipcRenderer.invoke('skills:remove-custom-source', sourceId),
  listHubSkillsBySource: (sourceId: string, workspaceRoot?: string, forceRefresh?: boolean) => ipcRenderer.invoke('skills:list-hub-by-source', sourceId, workspaceRoot, forceRefresh),
  listHubSkillsAcrossSources: (workspaceRoot?: string, forceRefresh?: boolean) => ipcRenderer.invoke('skills:list-hub-all', workspaceRoot, forceRefresh),
  toggleSkillActive: (skillId: string, isActive: boolean) => ipcRenderer.invoke('skills:toggle-active', skillId, isActive),
  installSkillFromHub: (hubSkillId: string, workspaceRoot?: string, hubSourceId?: string) => ipcRenderer.invoke('skills:install-from-hub', hubSkillId, workspaceRoot, hubSourceId),
  installSkillFromUrl: (url: string, workspaceRoot?: string, customName?: string) => ipcRenderer.invoke('skills:install-from-url', url, workspaceRoot, customName),
  saveCustomSkill: (input: any, workspaceRoot?: string) => ipcRenderer.invoke('skills:save-custom', input, workspaceRoot),
  resetSkillToOriginal: (skillId: string, workspaceRoot?: string) => ipcRenderer.invoke('skills:reset-original', skillId, workspaceRoot),
  uninstallSkill: (skillId: string, workspaceRoot?: string) => ipcRenderer.invoke('skills:uninstall', skillId, workspaceRoot),
  /** SLM Agent Studio: trigger log anomaly scan; returns structured diagnostic report. */
  agentLogsAnalyze: (extraPaths?: string[]) => ipcRenderer.invoke('agent:logs-analyze', extraPaths),
  /** Pre-flight Clarification Interview: analyze prompt for architectural decisions before drafting plan. */
  agentPlanInterview: (prompt: string, model: string | undefined, settings: AppSettings) =>
    ipcRenderer.invoke('agent:plan-interview', prompt, model, settings),
  /** Enriches prompt with user's confirmed interview answers. */
  agentPlanEnrichPrompt: (prompt: string, answers: any[]) =>
    ipcRenderer.invoke('agent:plan-enrich-prompt', prompt, answers),
  /** Plan Approval: draft a plan via the backend (hardware-routed), parsed into canonical milestones. */
  agentPlanGenerate: (prompt: string, model: string | undefined, settings: AppSettings, pendingResidueMilestones?: PlanMilestone[], workspacePath?: string | null) =>
    ipcRenderer.invoke('agent:plan-generate', prompt, model, settings, pendingResidueMilestones, workspacePath),
  /** Plan Approval: re-parse (e.g. user-edited) plan text into canonical milestones. */
  agentPlanParseText: (planText: string) => ipcRenderer.invoke('agent:plan-parse-text', planText),
  /** Plan Approval: read the backend's persisted plan milestone completion state for a session. */
  agentGetPlanState: (sessionId: string, workspacePath?: string | null) =>
    ipcRenderer.invoke('agent:get-plan-state', sessionId, workspacePath),
  /** Plan Approval: seed the approved plan's milestones into session state before execution starts. */
  agentPlanSeed: (sessionId: string, workspacePath: string | null, planMilestones: any[], userTask?: string) =>
    ipcRenderer.invoke('agent:plan-seed', sessionId, workspacePath, planMilestones, userTask),
  /** AI Debug Diagnostic Bundle: compile zero-noise high-density report for external AI analysis. */
  exportAiDebugBundle: (options: {
    sessionId: string
    workspacePath?: string | null
    settings?: AppSettings
    activeModelName?: string
    activeSkills?: string[]
  }) => ipcRenderer.invoke('agent:export-ai-debug-bundle', options),
}

contextBridge.exposeInMainWorld('electronAPI', api)
