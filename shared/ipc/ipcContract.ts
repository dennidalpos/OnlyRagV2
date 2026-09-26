/**
 * The single IPC contract between Renderer and Main. Every channel is declared once here: the
 * preload builds `window.electronAPI` from the method maps, `secureIpcMain` types each handler by
 * its channel, and `IElectronAPI` is derived from the same entries. An invoke channel takes one
 * object payload (or none), never a positional argument list.
 */
import type {
  AgentActionLog,
  AgentApprovalRequest,
  AgentChangeMetrics,
  AgentContextBudgetBreakdown,
  AgentDoneResult,
  AgentPlan,
  AgentPlanState,
  AgentRunIdentity,
  AgentTaskRequest,
  AppSettings,
  ArtifactRecord,
  ArtifactSaveInput,
  CodingSession,
  CustomHubInput,
  DiagnosticsData,
  GuestOsInfo,
  HubSkillItem,
  IngestedDocument,
  IngestedDocumentContent,
  IngestionStreamProgressPayload,
  InterviewAnalysisResult,
  InterviewQuestion,
  LogEntry,
  LogLevel,
  OllamaGenerationOptions,
  OllamaGenerationStatus,
  OllamaModelMetrics,
  OllamaModelUpdateInfo,
  OllamaPullProgressEvent,
  OllamaStreamChunkEvent,
  OllamaStreamDoneEvent,
  PagePreviewData,
  PlanGenerationResult,
  PlanMilestone,
  PromptHistoryIndexPayload,
  PromptHistorySearchResult,
  RunningModelInfo,
  SkillDefinition,
  SkillHubSource,
  SkillInstallApprovalRequest,
  SkillSaveInput,
  SlmLogDiagnosticReport,
  TaskQueueStatus,
  TranslateProgressPayload,
  UserInterviewAnswer,
  VectorSearchResult,
  WorkspaceFile,
  WorkspaceProject,
} from '../types'

type Success = { success: boolean; error?: string }
type SkillResult = { success: boolean; skill?: SkillDefinition; error?: string }
type DocumentResult = { success: boolean; data?: IngestedDocumentContent; error?: string }

/** Renderer → Main request/response channels: `payload` is `void` for channels without input. */
export interface IpcInvokeContract {
  'diagnostics:run': { payload: { host?: string }; result: DiagnosticsData }
  'diagnostics:get-logs': { payload: void; result: LogEntry[] }
  'diagnostics:clear-logs': { payload: void; result: boolean }
  'diagnostics:clear-agent-audit-log': { payload: void; result: boolean }
  'diagnostics:get-log-filepath': { payload: void; result: string }
  'diagnostics:open-logs-folder': { payload: void; result: { success: boolean; path?: string; error?: string } }
  'diagnostics:log-telemetry': { payload: { level: LogLevel; category: string; message: string }; result: boolean }
  'ollama:pull-model': { payload: { modelName: string; host?: string }; result: { success: boolean; data?: string; error?: string } }
  'ollama:cancel-pull': { payload: void; result: Success }
  'ollama:delete-model': { payload: { modelName: string; host?: string }; result: Success }
  'ollama:install-or-launch': { payload: void; result: { success: boolean; message?: string; error?: string } }
  'ollama:generate-stream': {
    payload: { model: string; prompt: string; options?: OllamaGenerationOptions; host?: string; operationId: string }
    result: Success
  }
  'ollama:cancel-stream': { payload: { operationId: string }; result: { success: boolean } }
  'ollama:get-generation-status': { payload: void; result: OllamaGenerationStatus }
  'ollama:test-connection': { payload: { host?: string }; result: { success: boolean; version?: string; modelsCount?: number; error?: string } }
  /** Per-model facts from Ollama's /api/tags: context length, capabilities, parameter size, quantization. */
  'ollama:get-model-metrics': { payload: { host?: string }; result: Record<string, OllamaModelMetrics> }
  /** Model updates checked against the official registry through SHA256 manifest digests. */
  'ollama:check-model-updates': { payload: { host?: string }; result: Record<string, OllamaModelUpdateInfo> }
  'ollama:get-running-models': { payload: { host?: string }; result: { success: boolean; models: RunningModelInfo[]; error?: string } }
  'ollama:unload-model': { payload: { modelName: string; host?: string }; result: Success }
  'sidecar:restart': { payload: void; result: { success: boolean; message?: string; error?: string } }
  'dialog:open-file': { payload: { title?: string; filters?: { name: string; extensions: string[] }[] }; result: string[] }
  'dialog:open-directory': { payload: { title?: string }; result: string | null }
  'ingest:file': {
    payload: {
      filePath: string
      visionModel?: string
      visionPrompt?: string
      normalizeWithLlm?: boolean
      normalizationModel?: string
      numCtx?: number
      taskId?: string
      normalizationThink?: boolean
    }
    result: DocumentResult
  }
  'ingest:update': { payload: { docId: string; markdownContent: string }; result: DocumentResult }
  'ingest:translate-inplace': {
    payload: { docId: string; sourceLang: string; targetLang: string; model?: string; targetDir?: string; numCtx?: number; think?: boolean }
    result: DocumentResult
  }
  'ingest:page-preview': { payload: { docId: string; pageNumber: number }; result: PagePreviewData | null }
  'ingest:list': { payload: void; result: IngestedDocument[] | null }
  'ingest:get': { payload: { docId: string }; result: IngestedDocumentContent | null }
  'ingest:delete': { payload: { docId: string }; result: Success }
  'ingest:search': { payload: { query: string; topK?: number; docIds?: string[] }; result: VectorSearchResult[] }
  'ingest:export': {
    payload: { markdownContent: string; format: string; outputFolder?: string }
    result: { success: boolean; message?: string; error?: string }
  }
  'task:cancel': { payload: { taskId?: string }; result: { success: boolean; message?: string } }
  'workspace:list-files': { payload: { dirPath?: string }; result: WorkspaceFile[] }
  'workspace:get-standalone-scratch': { payload: void; result: { path: string } }
  'workspace:export-standalone-scratch': { payload: { destinationDirectory: string }; result: { success: boolean; path?: string; error?: string } }
  'workspace:clear-standalone-scratch': { payload: void; result: { success: boolean; removedEntries: number; error?: string } }
  'workspace:read-file': {
    payload: { filePath: string; startLine?: number; endLine?: number }
    result: { success: boolean; content?: string; contentHash?: string; totalLines?: number; startLine?: number; endLine?: number; error?: string }
  }
  'workspace:write-file': {
    payload: { filePath: string; content: string; expectedContentHash?: string; workspaceRoot?: string }
    result: { success: boolean; contentHash?: string; currentContentHash?: string; currentContent?: string; conflict?: boolean; error?: string }
  }
  'workspace:get-git-status-and-diff': { payload: { workspaceRoot?: string }; result: { isGitRepo: boolean; statusLines: string[]; diffText: string } }
  'workspace:init-git': { payload: { workspaceRoot?: string }; result: { success: boolean; message: string } }
  'workspace:inspect-guest-os': { payload: void; result: GuestOsInfo }
  'workspace:execute-powershell': {
    payload: { command: string; cwd?: string; timeoutMs?: number }
    result: { success: boolean; output: string; error?: string }
  }
  'artifacts:list': { payload: { workspacePath: string }; result: ArtifactRecord[] }
  'artifacts:get': { payload: { workspacePath: string; artifactId: string }; result: ArtifactRecord | null }
  'artifacts:save': { payload: { workspacePath: string; input: ArtifactSaveInput }; result: ArtifactRecord }
  'artifacts:delete': { payload: { workspacePath: string; artifactId: string }; result: boolean }
  'system:check-disk-space': {
    payload: { models: string[] }
    result: { allowed: boolean; requiredGB: number; freeGB: number; missingGB: number; error?: string }
  }
  'system:open-external': { payload: { url: string }; result: boolean }
  'system:open-path': { payload: { targetPath: string }; result: boolean }
  'agent:start-task': { payload: AgentTaskRequest; result: AgentDoneResult & { error?: string; runId?: string; queuePosition?: number } }
  'agent:cancel-task': { payload: AgentRunIdentity; result: { success: boolean; message?: string } }
  /** Answers a pending `agent:approval-request`, resuming the paused orchestrator step. */
  'agent:approval-response': { payload: { identity: AgentRunIdentity; approved: boolean; approvedHunkIndices?: number[] }; result: boolean }
  'agent:compact-context': { payload: AgentRunIdentity; result: boolean }
  'agent:get-queue-status': { payload: void; result: TaskQueueStatus }
  /** SLM Agent Studio: log anomaly scan over the Main logs and any extra paths. */
  'agent:logs-analyze': { payload: { extraPaths?: string[] }; result: SlmLogDiagnosticReport }
  /** Pre-flight Clarification Interview before the plan is drafted. */
  'agent:plan-interview': {
    payload: {
      prompt: string
      model?: string
      settings: AppSettings
      workspacePath?: string | null
      previousDecisions?: UserInterviewAnswer[]
      identity?: AgentRunIdentity
    }
    result: InterviewAnalysisResult
  }
  'agent:plan-enrich-prompt': { payload: { prompt: string; answers: UserInterviewAnswer[]; questions: InterviewQuestion[] }; result: string }
  'agent:plan-generate': {
    payload: {
      prompt: string
      model?: string
      settings: AppSettings
      previousPlan?: AgentPlan
      workspacePath?: string | null
      previousDecisions?: UserInterviewAnswer[]
      identity?: AgentRunIdentity
    }
    result: PlanGenerationResult
  }
  'agent:plan-cancel': { payload: AgentRunIdentity; result: { success: boolean } }
  /** The persisted milestone completion state of a session's plan. */
  'agent:get-plan-state': { payload: { sessionId: string; workspacePath?: string | null; planRevisionId?: string }; result: AgentPlanState | null }
  /** Seeds the approved plan's milestones into session state before execution starts. */
  'agent:plan-seed': {
    payload: { sessionId: string; workspacePath: string | null; planMilestones: PlanMilestone[]; userTask?: string; planRevisionId?: string }
    result: boolean
  }
  /** Returns the files a finished, cancelled or timed-out run changed to their pre-run state. */
  'agent:restore-checkpoint': {
    payload: { workspacePath: string; checkpointId: string }
    result: { success: boolean; restoredCount: number; errors: string[] }
  }
  /** Self-contained Markdown debug bundle for external analysis. */
  'agent:export-ai-debug-bundle': {
    payload: { sessionId: string; workspacePath?: string | null; settings?: AppSettings; activeModelName?: string; activeSkills?: string[] }
    result: string
  }
  'sessions:list': { payload: { workspacePath?: string | null }; result: CodingSession[] }
  'sessions:save': { payload: CodingSession; result: CodingSession | null }
  'sessions:delete': { payload: { sessionId: string; workspacePath?: string | null }; result: boolean }
  'sessions:clear': { payload: { workspacePath?: string | null }; result: boolean }
  /** One-shot import of the sessions an older version kept in localStorage. */
  'sessions:migrate-legacy': { payload: { sessions: unknown }; result: { migrated: number } }
  'projects:list': { payload: void; result: WorkspaceProject[] }
  /** Explicit "add project": creates the entry, or refreshes its name, if unseen. */
  'projects:register': { payload: { projectPath: string; name?: string }; result: WorkspaceProject }
  /** Plain "select project": bumps recency only; null when the project is not registered. */
  'projects:touch': { payload: { projectPath: string }; result: WorkspaceProject | null }
  'projects:rename': { payload: { projectPath: string; name: string }; result: WorkspaceProject | null }
  'projects:remove': { payload: { projectPath: string }; result: boolean }
  /** One-shot import of the project list an older version kept in localStorage. */
  'projects:migrate-legacy': { payload: { projects: unknown }; result: { migrated: number } }
  'settings:get': { payload: void; result: AppSettings | null }
  'settings:save': { payload: AppSettings; result: boolean }
  /** Embeds and upserts one completed prompt into the semantic history index. */
  'history:index': { payload: PromptHistoryIndexPayload; result: { success: boolean } }
  /** Semantic search across every indexed project's prompt history. */
  'history:search': { payload: { query: string; topK?: number; projectPaths?: string[] }; result: PromptHistorySearchResult[] }
  'skills:list-installed': { payload: { workspaceRoot?: string }; result: SkillDefinition[] }
  'skills:list-sources': { payload: void; result: SkillHubSource[] }
  'skills:add-custom-source': { payload: CustomHubInput; result: { success: boolean; source?: SkillHubSource; error?: string } }
  'skills:remove-custom-source': { payload: { sourceId: string }; result: Success }
  'skills:list-hub-by-source': { payload: { sourceId: string; workspaceRoot?: string; forceRefresh?: boolean }; result: HubSkillItem[] }
  'skills:list-hub-all': { payload: { workspaceRoot?: string; forceRefresh?: boolean }; result: HubSkillItem[] }
  'skills:get-hub-skill-content': { payload: HubSkillItem; result: { success: boolean; content?: string; error?: string } }
  'skills:toggle-active': { payload: { skillId: string; isActive: boolean }; result: boolean }
  'skills:install-from-hub': { payload: { hubSkillId: string; workspaceRoot?: string; hubSourceId?: string }; result: SkillResult }
  'skills:install-from-url': { payload: { url: string; workspaceRoot?: string; customName?: string }; result: SkillResult }
  'skills:save-custom': { payload: { input: SkillSaveInput; workspaceRoot?: string }; result: SkillResult }
  'skills:reset-original': { payload: { skillId: string; workspaceRoot?: string }; result: SkillResult }
  'skills:uninstall': { payload: { skillId: string; workspaceRoot?: string }; result: Success }
}

export type IpcInvokeChannel = keyof IpcInvokeContract
export type IpcPayload<C extends IpcInvokeChannel> = IpcInvokeContract[C]['payload']
export type IpcResult<C extends IpcInvokeChannel> = IpcInvokeContract[C]['result']
/** What Main receives: a payload whose fields are all optional may be omitted by the Renderer. */
export type IpcReceivedPayload<C extends IpcInvokeChannel> = [IpcPayload<C>] extends [void]
  ? undefined
  : Record<string, never> extends IpcPayload<C>
    ? IpcPayload<C> | undefined
    : IpcPayload<C>

/** Renderer → Main fire-and-forget messages. */
export interface IpcSendContract {
  /** Skill Hub 'prompt' policy: the user's answer to a pending install request. */
  'agent:skill-install-response': AgentRunIdentity & { requestId: string; approved: boolean }
}

export type IpcSendChannel = keyof IpcSendContract

/** Main → Renderer events. */
export interface IpcEventContract {
  'agent:log': AgentActionLog & AgentRunIdentity
  'agent:step-update': AgentRunIdentity & { step: number; maxSteps: number; maxStepsLabel: string; statusText?: string; milestones?: readonly PlanMilestone[] }
  'agent:context-budget': AgentRunIdentity & AgentContextBudgetBreakdown
  /** Aggregate size of the file changes applied so far in the active agent session. */
  'agent:change-metrics': AgentChangeMetrics & AgentRunIdentity
  'agent:stream-token': AgentRunIdentity & { step: number; chunk: string }
  'agent:stream-thought': AgentRunIdentity & { step: number; chunk: string }
  'agent:done': AgentDoneResult & AgentRunIdentity
  'agent:approval-request': AgentApprovalRequest
  /** Skill Hub 'prompt' policy: install request raised while the turn prompt is assembled. */
  'agent:skill-install-request': SkillInstallApprovalRequest
  'agent:skills-matched': AgentRunIdentity & { skills: string[] }
  'workspace:file-deleted': { filePath: string }
  'workspace:file-version': AgentRunIdentity & { filePath: string; contentHash?: string; deleted?: boolean }
  'ingest:stream-progress': IngestionStreamProgressPayload
  'ingest:translate-progress': TranslateProgressPayload
  'ollama:pull-progress': OllamaPullProgressEvent
  'ollama:chunk': OllamaStreamChunkEvent
  'ollama:done': OllamaStreamDoneEvent
}

export type IpcEventChannel = keyof IpcEventContract

/** `window.electronAPI` methods that invoke one channel with the caller's payload. */
export const IPC_INVOKE_METHODS = {
  runDiagnostics: 'diagnostics:run',
  getLogs: 'diagnostics:get-logs',
  clearLogs: 'diagnostics:clear-logs',
  clearCodingAgentAuditLog: 'diagnostics:clear-agent-audit-log',
  getLogFilePath: 'diagnostics:get-log-filepath',
  openLogsFolder: 'diagnostics:open-logs-folder',
  logTelemetry: 'diagnostics:log-telemetry',
  pullOllamaModel: 'ollama:pull-model',
  cancelPullOllamaModel: 'ollama:cancel-pull',
  deleteOllamaModel: 'ollama:delete-model',
  installOrLaunchOllama: 'ollama:install-or-launch',
  cancelOllamaStream: 'ollama:cancel-stream',
  getOllamaGenerationStatus: 'ollama:get-generation-status',
  testOllamaConnection: 'ollama:test-connection',
  getOllamaModelMetrics: 'ollama:get-model-metrics',
  checkOllamaModelUpdates: 'ollama:check-model-updates',
  getRunningModels: 'ollama:get-running-models',
  unloadModel: 'ollama:unload-model',
  restartSidecar: 'sidecar:restart',
  openFileDialog: 'dialog:open-file',
  openDirectoryDialog: 'dialog:open-directory',
  ingestFile: 'ingest:file',
  updateIngestedDocument: 'ingest:update',
  translateDocumentInplace: 'ingest:translate-inplace',
  getDocumentPagePreview: 'ingest:page-preview',
  getIngestedDocuments: 'ingest:list',
  getIngestedDocument: 'ingest:get',
  deleteIngestedDocument: 'ingest:delete',
  searchVectorDb: 'ingest:search',
  exportDocument: 'ingest:export',
  cancelTask: 'task:cancel',
  listWorkspaceFiles: 'workspace:list-files',
  getStandaloneScratchWorkspace: 'workspace:get-standalone-scratch',
  exportStandaloneScratchWorkspace: 'workspace:export-standalone-scratch',
  clearStandaloneScratchWorkspace: 'workspace:clear-standalone-scratch',
  readWorkspaceFile: 'workspace:read-file',
  writeWorkspaceFile: 'workspace:write-file',
  getGitStatusAndDiff: 'workspace:get-git-status-and-diff',
  initGitRepository: 'workspace:init-git',
  inspectGuestOsEnvironment: 'workspace:inspect-guest-os',
  executePowerShellCommand: 'workspace:execute-powershell',
  listArtifacts: 'artifacts:list',
  getArtifact: 'artifacts:get',
  saveArtifact: 'artifacts:save',
  deleteArtifact: 'artifacts:delete',
  checkDiskSpace: 'system:check-disk-space',
  openExternalUrl: 'system:open-external',
  openPath: 'system:open-path',
  startAgentTask: 'agent:start-task',
  cancelAgentTask: 'agent:cancel-task',
  respondToAgentApproval: 'agent:approval-response',
  compactAgentContext: 'agent:compact-context',
  getAgentQueueStatus: 'agent:get-queue-status',
  agentLogsAnalyze: 'agent:logs-analyze',
  agentPlanInterview: 'agent:plan-interview',
  agentPlanEnrichPrompt: 'agent:plan-enrich-prompt',
  agentPlanGenerate: 'agent:plan-generate',
  agentPlanCancel: 'agent:plan-cancel',
  agentGetPlanState: 'agent:get-plan-state',
  agentPlanSeed: 'agent:plan-seed',
  restoreAgentCheckpoint: 'agent:restore-checkpoint',
  exportAiDebugBundle: 'agent:export-ai-debug-bundle',
  listCodingSessions: 'sessions:list',
  saveCodingSession: 'sessions:save',
  deleteCodingSession: 'sessions:delete',
  clearCodingSessions: 'sessions:clear',
  migrateLegacyCodingSessions: 'sessions:migrate-legacy',
  listProjects: 'projects:list',
  registerProject: 'projects:register',
  touchProject: 'projects:touch',
  renameProject: 'projects:rename',
  removeProjectFromRegistry: 'projects:remove',
  migrateLegacyProjects: 'projects:migrate-legacy',
  getAppSettings: 'settings:get',
  saveAppSettings: 'settings:save',
  indexPromptHistory: 'history:index',
  searchPromptHistory: 'history:search',
  listInstalledSkills: 'skills:list-installed',
  listHubSources: 'skills:list-sources',
  addCustomHubSource: 'skills:add-custom-source',
  removeCustomHubSource: 'skills:remove-custom-source',
  listHubSkillsBySource: 'skills:list-hub-by-source',
  listHubSkillsAcrossSources: 'skills:list-hub-all',
  getHubSkillContent: 'skills:get-hub-skill-content',
  toggleSkillActive: 'skills:toggle-active',
  installSkillFromHub: 'skills:install-from-hub',
  installSkillFromUrl: 'skills:install-from-url',
  saveCustomSkill: 'skills:save-custom',
  resetSkillToOriginal: 'skills:reset-original',
  uninstallSkill: 'skills:uninstall',
} as const satisfies Record<string, Exclude<IpcInvokeChannel, 'ollama:generate-stream'>>

/** `window.electronAPI` subscriptions: each returns its unsubscribe function. */
export const IPC_EVENT_METHODS = {
  onAgentLog: 'agent:log',
  onAgentStepUpdate: 'agent:step-update',
  onAgentContextBudget: 'agent:context-budget',
  onAgentChangeMetrics: 'agent:change-metrics',
  onAgentStreamToken: 'agent:stream-token',
  onAgentStreamThought: 'agent:stream-thought',
  onAgentDone: 'agent:done',
  onAgentApprovalRequest: 'agent:approval-request',
  onAgentSkillInstallRequest: 'agent:skill-install-request',
  onAgentSkillsMatched: 'agent:skills-matched',
  onWorkspaceFileDeleted: 'workspace:file-deleted',
  onWorkspaceFileVersionChanged: 'workspace:file-version',
  onIngestStreamProgress: 'ingest:stream-progress',
  onTranslateProgress: 'ingest:translate-progress',
  onOllamaPullProgress: 'ollama:pull-progress',
} as const satisfies Record<string, Exclude<IpcEventChannel, 'ollama:chunk' | 'ollama:done'>>

/** @internal Channels without a `window.electronAPI` method; the preload test requires `never` for both. */
export type UnmappedIpcChannels = {
  invoke: Exclude<IpcInvokeChannel, 'ollama:generate-stream' | (typeof IPC_INVOKE_METHODS)[keyof typeof IPC_INVOKE_METHODS]>
  event: Exclude<IpcEventChannel, 'ollama:chunk' | 'ollama:done' | (typeof IPC_EVENT_METHODS)[keyof typeof IPC_EVENT_METHODS]>
}

/** A payload whose fields are all optional may be omitted by the caller. */
type InvokeMethod<C extends IpcInvokeChannel> = [IpcPayload<C>] extends [void]
  ? () => Promise<IpcResult<C>>
  : Record<string, never> extends IpcPayload<C>
    ? (payload?: IpcPayload<C>) => Promise<IpcResult<C>>
    : (payload: IpcPayload<C>) => Promise<IpcResult<C>>

type InvokeMethods = { [M in keyof typeof IPC_INVOKE_METHODS]: InvokeMethod<(typeof IPC_INVOKE_METHODS)[M]> }
type EventMethods = { [M in keyof typeof IPC_EVENT_METHODS]: (callback: (data: IpcEventContract[(typeof IPC_EVENT_METHODS)[M]]) => void) => () => void }

export type OllamaStreamRequest = Omit<IpcPayload<'ollama:generate-stream'>, 'operationId'> & { operationId?: string }

export type IElectronAPI = InvokeMethods &
  EventMethods & {
    /** Streams one generation; chunks and completion are matched to this call by its operation id. */
    generateOllamaStream: (request: OllamaStreamRequest, onChunk: (chunk: string) => void, onDone?: () => void) => Promise<IpcResult<'ollama:generate-stream'>>
    respondAgentSkillInstall: (response: IpcSendContract['agent:skill-install-response']) => void
  }

declare global {
  interface Window {
    electronAPI?: IElectronAPI
  }
}
