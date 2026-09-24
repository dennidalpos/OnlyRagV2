/** External untrusted JSON, narrowed by consumers at system boundaries. */
// biome-ignore lint/suspicious/noExplicitAny: narrowed at consumption
export type UntrustedJson = any

export interface SystemRequirementsCheck {
  isOsSupported: boolean
  hasMinRam: boolean
  hasRecRam: boolean
  isOllamaReady: boolean
  isGpuAccelerated: boolean
  isSidecarReady: boolean
  overallStatus: 'optimal' | 'warning' | 'incompatible'
}

export interface DiagnosticsData {
  sidecar: {
    status: 'online' | 'offline' | 'checking'
    engine?: string
    version?: string
    endpoint?: string
    documentsCount?: number
    chunksCount?: number
    error?: string
    ocr?: {
      provider: string
      host_has_gpu: boolean
    }
  }
  ollama: {
    status: 'online' | 'offline' | 'checking'
    url: string
    modelsCount: number
    models: string[]
    /** Optional metadata from `/api/tags`. */
    modelDetails?: Record<string, RunningModelDetails>
    error?: string
  }
  gpu: {
    hasNvidiaGpu: boolean
    gpuName?: string
    vramTotalMB?: number
    vramUsedMB?: number
    cudaVersion?: string
    driverVersion?: string
    error?: string
  }
  memory: {
    totalRAMGB: number
    freeRAMGB: number
    usedRAMGB: number
    ramUsagePercent: number
  }
  system: {
    platform: string
    arch: string
    cpusCount: number
    cpuModel: string
  }
  requirements: SystemRequirementsCheck
  timestamp: string
}

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

export interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  category: string
}

/** Metadata of an indexed document, as listed by `ingest:list`. */
export interface IngestedDocument {
  id: string
  filename: string
  filePath: string
  fileSize: number
  numPages: number
  numChunks: number
  status: 'processing' | 'indexed' | 'indexed_fallback' | 'error'
  ingestedAt: string
  fileType: 'pdf' | 'image' | 'docx' | 'text'
  usedFallbackEmbeddings?: boolean
}

/** A document with its extracted Markdown: `ingest:get`, ingestion, update and translation results. */
export interface IngestedDocumentContent extends IngestedDocument {
  extractedMarkdown: string
}

export interface VectorSearchResult {
  chunk_id: string
  doc_id?: string
  doc_name: string
  section_header?: string
  text: string
  score: number
}

/** One semantic match from the cross-project prompt history index (see sidecar's /history/search). */
export interface PromptHistorySearchResult {
  id: string
  session_id: string
  project_id: string
  project_path: string
  prompt: string
  summary?: string
  outcome: ExecutedPromptOutcome
  started_at: string
  completed_at?: string
  score: number
}

export interface CitationSource {
  docName: string
  chunkId: string
  score: number
  snippet: string
  sectionHeader?: string
}

export interface ChatMessage {
  id: string
  sender: 'user' | 'bot'
  text: string
  timestamp: string
  sources?: CitationSource[]
  isStreaming?: boolean
}

export interface ChatConversation {
  id: string
  title: string
  messages: ChatMessage[]
  selectedDocIds: string[]
  createdAt: string
  updatedAt: string
}

export interface WorkspaceFile {
  name: string
  path: string
  isDir: boolean
  sizeBytes?: number
}

export type ArtifactKind = 'html' | 'svg' | 'markdown'

export interface ArtifactRecord {
  id: string
  workspacePath: string
  name: string
  kind: ArtifactKind
  content: string
  createdAt: string
  updatedAt: string
}

export interface ArtifactSaveInput {
  id?: string
  name: string
  kind: ArtifactKind
  content: string
}

export type AgentMode = 'ask' | 'guided' | 'auto'

export interface AgentRunIdentity {
  runId: string
  conversationId: string
  planRevisionId: string
  workspaceId: string
}

export type AgentLogCategory =
  | 'user_prompt'
  | 'agent_thought'
  | 'tool_execution'
  | 'file_mutation'
  | 'command_execution'
  | 'test_run'
  | 'workspace_exploration'
  | 'web_research'
  | 'final_report'
  | 'agent_question'
  | 'system_alert'
  | 'generic_info'

export interface AgentActionLog extends Partial<AgentRunIdentity> {
  id: string
  timestamp: string
  type: 'info' | 'tool_call' | 'terminal' | 'approval_request'
  message: string
  detail?: string
  category?: AgentLogCategory
  toolName?: string
  target?: string
  status?: 'running' | 'success' | 'failure'
  modelName?: string
  verb?: 'Created' | 'Edited' | 'Deleted' | 'Moved' | 'Copied' | 'Ran' | 'Read' | 'Search' | 'Fetch' | 'Download' | 'Symbols' | 'List'
  testRun?: {
    isPass: boolean
    summary: string
    passedCount?: number
    failedCount?: number
  }
  /** Main-side text in message keys the renderer shows in the UI language; `message`/`detail` hold the Italian fallback. */
  localized?: AgentLocalizedLog
  meta?: Record<string, unknown>
}

import type { AgentCompletionEvidence, AgentCompletionStatus, ExecutedPrompt, ExecutedPromptOutcome, QueuedPromptRecord, WorkspaceProject } from './workspace'
import type { AgentLocalizedLog } from '../domain/agent/agentMainText'

export * from './workspace'

export interface AppSettings {
  defaultModel: string
  chatModel?: string
  translationModel?: string
  medicalModel?: string
  legalModel?: string
  codingModel?: string
  visionModel?: string
  embeddingModel?: string
  allowTerminalExecution?: boolean
  allowFileModifications?: boolean
  /** Agent capability policy. Undefined preserves the legacy unrestricted mode until configured. */
  capabilityPolicyMode?: 'offline-strict' | 'local-only' | 'network-approved'
  ocrEngine: 'native_cuda' | 'vision_model'
  normalizeWithLlm?: boolean
  ollamaHost: string
  /** Ollama mode: 'local' (127.0.0.1:11434) or 'remote'. Default: 'local'. */
  ollamaMode?: 'local' | 'remote'
  customWorkspacePath?: string
  noWorkspaceMode?: boolean
  /** Default translation export folder; unset uses save dialog. */
  translationOutputFolder?: string
  /** User-edited system prompts keyed by prompt node id. */
  customPromptOverrides?: Record<string, string>
  maxToolCallSteps?: number
  enableCodingAgentDebugLog?: boolean
  /** Opt-in for full prompts, snippets and tool payloads in audit log. */
  includeCodingAgentDebugPayloads?: boolean
  /** Audit log generations retained on disk. */
  codingAgentDebugRetentionFiles?: number
  /** Per-model binary thinking preferences. */
  modelThinkingPreferences?: Record<string, boolean>
  enablePrePlanInterview?: boolean
  verifyBeforeFinish?: boolean
  agentSessionTimeoutMinutes?: number
  hasCompletedInitialSetup?: boolean
  enableSkillRouter?: boolean
  autoInstallHubSkills?: 'disabled' | 'prompt'
  autoInstallMinScore?: number
  language?: 'it' | 'en'
  enableSoundEffects?: boolean
  editorWordWrap?: boolean
  /** Per-model context limit in tokens. */
  modelContextLengths?: Record<string, number>
}

/** Per-run Agent Coding permissions, persisted with a reviewed plan. */
export interface AgentCapabilityProfile {
  allowFileModifications: boolean
  allowTerminalExecution: boolean
  capabilityPolicyMode: 'offline-strict' | 'local-only' | 'network-approved'
  maxToolCallSteps: number
}

/** Editor file sent with an agent run; `versionHash` is the SHA-256 of `content`. */
export interface ActiveFileContext {
  name: string
  path: string
  content: string
  versionHash: string
}

/** Renderer → Main request for `agent:start-task`, validated by agentTaskRequestSchema in Main. */
export interface AgentTaskRequest {
  identity: AgentRunIdentity
  sessionId?: string
  userTask: string
  initialUserTask?: string
  agentMode: AgentMode
  workspacePath?: string | null
  isStandaloneMode?: boolean
  activeModel?: string
  activeFile?: ActiveFileContext | null
  pinnedFiles?: { name: string; path: string; content: string }[]
  attachedDocs?: { id: string; filename: string; extractedMarkdown: string }[]
  /** User-reviewed runtime constraints for this execution only. */
  capabilityProfile?: AgentCapabilityProfile
  /** Keeps the visible audit timeline intact while asking Main to send a smaller model context. */
  forceContextCompaction?: boolean
  settings?: AppSettings
}

/** Aggregate size of the file changes an agent session has applied so far. */
export interface AgentChangeMetrics {
  filesTouched: number
  additions: number
  deletions: number
}

/** Prompt-window measurements emitted by Main after assembling the actual Agent turn. */
export interface AgentContextBudgetBreakdown {
  model: string
  contextWindowTokens: number
  outputReserveTokens: number
  promptBudgetTokens: number
  originalPromptTokens: number
  promptTokens: number
  utilizationPercent: number
  wasCompacted: boolean
  manualCompaction: boolean
}

export interface TaskQueueStatus {
  maxConcurrency: number
  runningCount: number
  queuedCount: number
  runningTasks: { id: string; type: string; status: string; createdAt: number }[]
  queuedTasks: { id: string; type: string; status: string; createdAt: number }[]
}

export interface GrepSearchResult {
  filePath: string
  relativePath: string
  lineNumber: number
  lineContent: string
}

export interface GuestOsInfo {
  platform: string
  arch: string
  release: string
  hostname: string
  cpuCount: number
  cpuModel: string
  totalMemoryGB: number
  freeMemoryGB: number
  nodeVersion: string
  electronVersion: string
  tools: {
    git: boolean
    node: boolean
    npm: boolean
    python: boolean
    ollama: boolean
  }
}

export interface AgentToolCall {
  tool:
    | 'read_file'
    | 'replace_file_content'
    | 'multi_replace_file_content'
    | 'write_file'
    | 'delete_file'
    | 'grep_search'
    | 'list_dir'
    | 'web_search'
    | 'fetch_web_content'
    | 'download_file'
    | 'run_command'
    | 'inspect_os_env'
    | 'ask'
    | 'finish'
  parameters: Record<string, UntrustedJson>
  explanation?: string
}

/** An agent action waiting for the user's approval, as Main sends it on `agent:approval-request`. */
export interface AgentApprovalRequest extends AgentRunIdentity {
  sessionId: string
  type: 'write_file' | 'replace_chunk' | 'multi_replace' | 'delete_file' | 'download_file' | 'terminal_cmd' | 'git_commit'
  target: string
  contentOrCmd: string
  replacement?: string
  replacements?: { targetContent: string; replacementContent: string }[]
  parameters?: Record<string, UntrustedJson>
}

/** One progress event of `ollama pull`, as Main forwards it on the pull progress channel. */
export interface OllamaPullProgressEvent {
  modelName: string
  status: string
  completed?: number
  total?: number
}

export interface CodingSession {
  id: string
  workspacePath: string | null
  title: string
  createdAt: string
  updatedAt: string
  actionLogs: AgentActionLog[]
  /** Executed prompts in chronological order. */
  executedPrompts: ExecutedPrompt[]
  /** Drafted plan versions in chronological order. */
  plans?: AgentPlan[]
  promptQueue?: QueuedPromptRecord[]
  pinnedFilePaths?: string[]
  forceContextCompaction?: boolean
  contextBudget?: AgentContextBudgetBreakdown
}

/** Hub skill installation confirmation request. */
export interface SkillInstallApprovalRequest extends AgentRunIdentity {
  requestId: string
  skillName: string
  skillDescription: string
  hubName: string
  score: number
}

export type SkillOriginType = 'local_custom' | 'hub_original' | 'hub_modified'

export interface SkillDefinition {
  id: string
  name: string
  description: string
  content: string
  filePath: string
  isActive: boolean
  isWorkspaceLocal: boolean
  triggers: string[]
  tags: string[]
  version?: string
  author?: string
  originType: SkillOriginType
  originHub?: string
  originHubId?: string
  originChecksum?: string
  isModified?: boolean
}

export type SkillCategory = 'frontend' | 'backend' | 'database' | 'security' | 'architecture' | 'ai-ml' | 'devops'

export interface HubSkillItem {
  id: string
  name: string
  description: string
  category: SkillCategory
  tags: string[]
  triggers: string[]
  rawContent?: string
  downloadUrl?: string
  version: string
  author: string
  hubId?: string
  hubName?: string
  isInstalled?: boolean
  requiredModel?: string
  qualityScore?: number
  globalRank?: number
  compatibility?: HubSkillCompatibility
}

export interface HubSkillCompatibility {
  status: 'compatible' | 'modified' | 'incompatible' | 'unknown'
  modelStatus: 'not_required' | 'available' | 'missing' | 'unknown'
  checksumStatus: 'not_installed' | 'match' | 'changed' | 'unknown'
  localChecksum?: string
  remoteChecksum?: string
  matchedModel?: string
}

export type HubSourceType = 'builtin' | 'json-catalog' | 'github-repo'

export interface SkillHubSource {
  id: string
  name: string
  url: string
  type: HubSourceType
  description: string
  isBuiltin: boolean
  isReadOnly?: boolean
}

export interface CustomHubInput {
  name: string
  url: string
  type?: HubSourceType
  description?: string
}

export interface SkillSaveInput {
  name: string
  description?: string
  version?: string
  author?: string
  triggers?: string[]
  tags?: string[]
  content: string
  originHub?: string
  originHubId?: string
  originChecksum?: string
  isModified?: boolean
}

export interface IngestionStreamProgressPayload {
  taskId: string
  type: 'progress' | 'done'
  percent: number
  /** English fallback text; the renderer shows `step_code` (with `step_params`) translated when it knows the code. */
  step: string
  step_code?: string
  step_params?: Record<string, string | number>
  pipeline?: string
  page?: number
  total_pages?: number
  fileName?: string
  ocrTechnology?: string
  modelName?: string
  data?: IngestedDocument
}

export interface TranslateProgressPayload {
  /** Main's id for the running job; `task:cancel` with it stops the job. */
  taskId?: string
  type: 'start' | 'progress' | 'done' | 'error' | 'cancelled'
  doc_id?: string
  filename?: string
  page?: number
  total_pages?: number
  total_blocks?: number
  phase?: 'extracting_blocks' | 'translating_blocks' | 'reconstructing_layout' | 'translating_runs'
  percent?: number
  error?: string
  data?: IngestedDocument
}

export interface PagePreviewData {
  docId: string
  pageNumber: number
  totalPages: number
  imageBase64: string
  mimeType: string
}

/** The per-model facts Ollama reports on /api/tags. */
export interface OllamaModelMetrics {
  capabilities: string[]
  /** Trained context length in tokens. Ollama clamps any larger num_ctx down to this. */
  contextLength?: number
  parameterSize?: string
  quantizationLevel?: string
  family?: string
  sizeBytes?: number
  digest?: string
}

export interface OllamaModelUpdateInfo {
  updateAvailable: boolean
  localDigest?: string
  remoteDigest?: string
  error?: string
}

export interface PromptHistoryIndexPayload {
  id: string
  sessionId: string
  workspacePath: string
  prompt: string
  summary?: string
  outcome: ExecutedPromptOutcome
  startedAt: string
  completedAt?: string
}

export type OllamaGenerationOperationState = 'queued' | 'running' | 'cancelling' | 'failed'

export interface OllamaGenerationOperation {
  id: string
  label: string
  state: OllamaGenerationOperationState
}

export interface OllamaGenerationStatus {
  active: { id: string; label: string } | null
  queued: { id: string; label: string }[]
  operations: OllamaGenerationOperation[]
}

export interface OllamaStreamChunkEvent {
  operationId: string
  chunk: string
}

export interface OllamaStreamDoneEvent {
  operationId: string
}

export interface OllamaGenerationOptions {
  num_ctx?: number
  temperature?: number
  top_p?: number
  repeat_penalty?: number
  num_thread?: number
  keep_alive?: string
  /** Effective, already policy-gated binary thinking choice. */
  think?: boolean
}

export interface IElectronAPI {
  runDiagnostics: (host?: string) => Promise<DiagnosticsData>
  getLogs: () => Promise<LogEntry[]>
  clearLogs: () => Promise<boolean>
  clearCodingAgentAuditLog?: () => Promise<boolean>
  getLogFilePath: () => Promise<string>
  openLogsFolder: () => Promise<{ success: boolean; path?: string; error?: string }>
  logTelemetry: (level: LogLevel, category: string, message: string) => Promise<boolean>
  pullOllamaModel: (modelName: string, host?: string) => Promise<{ success: boolean; data?: string; error?: string }>
  cancelPullOllamaModel: () => Promise<{ success: boolean; error?: string }>
  deleteOllamaModel: (modelName: string, host?: string) => Promise<{ success: boolean; error?: string }>
  installOrLaunchOllama: () => Promise<{ success: boolean; message?: string; error?: string }>
  restartSidecar: () => Promise<{ success: boolean; message?: string; error?: string }>
  openFileDialog: (options?: { title?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string[]>
  openDirectoryDialog: (options?: { title?: string }) => Promise<string | null>
  ingestFile: (
    filePath: string,
    visionModel?: string,
    visionPrompt?: string,
    normalizeWithLlm?: boolean,
    normalizationModel?: string,
    numCtx?: number,
    taskId?: string,
    normalizationThink?: boolean,
  ) => Promise<{ success: boolean; data?: IngestedDocumentContent; error?: string }>
  updateIngestedDocument: (docId: string, markdownContent: string) => Promise<{ success: boolean; data?: IngestedDocumentContent; error?: string }>
  translateDocumentInplace: (
    docId: string,
    sourceLang: string,
    targetLang: string,
    model?: string,
    targetDir?: string,
    numCtx?: number,
    think?: boolean,
  ) => Promise<{ success: boolean; data?: IngestedDocumentContent; error?: string }>
  getDocumentPagePreview: (docId: string, pageNumber: number) => Promise<PagePreviewData | null>
  getIngestedDocuments: () => Promise<IngestedDocument[] | null>
  getIngestedDocument: (docId: string) => Promise<IngestedDocumentContent | null>
  deleteIngestedDocument: (docId: string) => Promise<{ success: boolean; error?: string }>
  searchVectorDb: (query: string, topK?: number, docIds?: string[]) => Promise<VectorSearchResult[]>
  exportDocument: (markdownContent: string, format: string, outputFolder?: string) => Promise<{ success: boolean; message?: string; error?: string }>
  generateOllamaStream: (
    model: string,
    prompt: string,
    onChunk: (chunk: string) => void,
    options?: OllamaGenerationOptions,
    host?: string,
    operationId?: string,
    onDone?: () => void,
  ) => Promise<{ success: boolean; error?: string }>
  cancelOllamaStream: (operationId: string) => Promise<{ success: boolean }>
  getOllamaGenerationStatus: () => Promise<OllamaGenerationStatus>
  cancelTask: (taskId?: string) => Promise<{ success: boolean; message?: string }>
  listWorkspaceFiles: (dirPath?: string) => Promise<WorkspaceFile[]>
  getStandaloneScratchWorkspace?: () => Promise<{ path: string }>
  exportStandaloneScratchWorkspace?: (destinationDirectory: string) => Promise<{ success: boolean; path?: string; error?: string }>
  clearStandaloneScratchWorkspace?: () => Promise<{ success: boolean; removedEntries: number; error?: string }>
  readWorkspaceFile: (
    filePath: string,
    startLine?: number,
    endLine?: number,
  ) => Promise<{ success: boolean; content?: string; contentHash?: string; totalLines?: number; startLine?: number; endLine?: number; error?: string }>
  writeWorkspaceFile: (
    filePath: string,
    content: string,
    expectedContentHash?: string,
    workspaceRoot?: string,
  ) => Promise<{ success: boolean; contentHash?: string; currentContentHash?: string; currentContent?: string; conflict?: boolean; error?: string }>
  replaceWorkspaceFileChunk: (filePath: string, targetContent: string, replacementContent: string) => Promise<{ success: boolean; error?: string }>
  grepWorkspaceFiles: (dirPath: string, query: string, isRegex?: boolean, caseInsensitive?: boolean) => Promise<GrepSearchResult[]>
  searchWeb: (query: string, maxResults?: number) => Promise<{ success: boolean; results: { title: string; url: string; snippet: string }[]; error?: string }>
  fetchWebContent: (url: string, maxChars?: number) => Promise<{ success: boolean; content?: string; title?: string; error?: string }>
  downloadFile: (url: string, targetFilePath: string) => Promise<{ success: boolean; downloadedBytes?: number; error?: string }>
  getGitStatusAndDiff?: (workspaceRoot?: string) => Promise<{ isGitRepo: boolean; statusLines: string[]; diffText: string }>
  initGitRepository?: (workspaceRoot?: string) => Promise<{ success: boolean; message: string }>
  inspectGuestOsEnvironment: () => Promise<GuestOsInfo>
  executePowerShellCommand: (command: string, cwd?: string, timeoutMs?: number) => Promise<{ success: boolean; output: string; error?: string }>
  listArtifacts?: (workspacePath: string) => Promise<ArtifactRecord[]>
  getArtifact?: (workspacePath: string, artifactId: string) => Promise<ArtifactRecord | null>
  saveArtifact?: (workspacePath: string, input: ArtifactSaveInput) => Promise<ArtifactRecord>
  deleteArtifact?: (workspacePath: string, artifactId: string) => Promise<boolean>
  parseAgentToolCall: (rawText: string) => Promise<AgentToolCall | null>
  checkDiskSpace: (models: string[]) => Promise<{ allowed: boolean; requiredGB: number; freeGB: number; missingGB: number; error?: string }>
  testOllamaConnection: (host?: string) => Promise<{ success: boolean; version?: string; modelsCount?: number; error?: string }>
  /** Per-model facts from Ollama's /api/tags: context length, capabilities, parameter size, quantization. */
  getOllamaModelMetrics: (host?: string) => Promise<Record<string, OllamaModelMetrics>>
  /** Checks for model updates against official registry using SHA256 manifest digests. */
  checkOllamaModelUpdates?: (host?: string) => Promise<Record<string, OllamaModelUpdateInfo>>
  openExternalUrl?: (url: string) => Promise<boolean>
  openPath?: (targetPath: string) => Promise<boolean>
  startAgentTask: (payload: AgentTaskRequest) => Promise<AgentDoneResult & { error?: string; runId?: string; queuePosition?: number }>
  cancelAgentTask: (identity: AgentRunIdentity) => Promise<{ success: boolean; message?: string }>
  /** Answers a pending `agent:approval-request`, resuming the paused orchestrator step. */
  respondToAgentApproval?: (identity: AgentRunIdentity, approved: boolean, approvedHunkIndices?: number[]) => Promise<boolean>
  getAgentQueueStatus: () => Promise<TaskQueueStatus>
  /** Session history CRUD backed by the filesystem store (see sessionHistoryRepository). */
  listCodingSessions?: (workspacePath?: string | null) => Promise<CodingSession[]>
  saveCodingSession?: (session: CodingSession) => Promise<CodingSession | null>
  deleteCodingSession?: (sessionId: string, workspacePath?: string | null) => Promise<boolean>
  clearCodingSessions?: (workspacePath?: string | null) => Promise<boolean>
  /** One-shot import of sessions previously persisted in localStorage. */
  migrateLegacyCodingSessions?: (sessions: unknown) => Promise<{ migrated: number }>
  /** Main-process-owned registry of every project the user has ever opened (see projectRegistryRepository). */
  listProjects?: () => Promise<WorkspaceProject[]>
  /** Explicit "add project" -- creates the entry (or refreshes its name) if unseen. */
  registerProject?: (projectPath: string, name?: string) => Promise<WorkspaceProject>
  /** Plain "select project" -- bumps recency only; returns null if the project isn't registered. */
  touchProject?: (projectPath: string) => Promise<WorkspaceProject | null>
  renameProject?: (projectPath: string, name: string) => Promise<WorkspaceProject | null>
  removeProjectFromRegistry?: (projectPath: string) => Promise<boolean>
  /** One-shot import of the project list previously persisted in localStorage. */
  migrateLegacyProjects?: (projects: unknown) => Promise<{ migrated: number }>
  /** Unified filesystem settings store (settings.json under userData). */
  getAppSettings?: () => Promise<AppSettings | null>
  saveAppSettings?: (settings: AppSettings) => Promise<boolean>
  /** Fire-and-forget: embeds and upserts one completed prompt into the semantic history index. */
  indexPromptHistory?: (payload: PromptHistoryIndexPayload) => Promise<{ success: boolean }>
  /** Semantic search across every indexed project's prompt history. */
  searchPromptHistory?: (query: string, topK?: number, projectPaths?: string[]) => Promise<PromptHistorySearchResult[]>
  onAgentLog: (callback: (log: AgentActionLog & AgentRunIdentity) => void) => () => void
  onAgentStepUpdate?: (
    callback: (data: AgentRunIdentity & { step: number; maxSteps: number; maxStepsLabel: string; statusText?: string; milestones?: PlanMilestone[] }) => void,
  ) => () => void
  onAgentContextBudget?: (callback: (data: AgentRunIdentity & AgentContextBudgetBreakdown) => void) => () => void
  compactAgentContext?: (identity: AgentRunIdentity) => Promise<boolean>
  onAgentStreamToken?: (callback: (data: AgentRunIdentity & { step: number; chunk: string }) => void) => () => void
  onAgentStreamThought?: (callback: (data: AgentRunIdentity & { step: number; chunk: string }) => void) => () => void
  onAgentDone: (callback: (res: AgentDoneResult & AgentRunIdentity) => void) => () => void
  onAgentApprovalRequest: (callback: (req: AgentApprovalRequest) => void) => () => void
  onAgentSkillsMatched?: (callback: (data: AgentRunIdentity & { skills: string[] }) => void) => () => void
  /** Skill Hub 'prompt' policy: subscribe to the auto-install confirmation requests. */
  onAgentSkillInstallRequest?: (callback: (req: SkillInstallApprovalRequest) => void) => () => void
  /** Skill Hub 'prompt' policy: answer a pending auto-install confirmation request. */
  respondAgentSkillInstall?: (requestId: string, approved: boolean, identity: AgentRunIdentity) => void
  onAgentChangeMetrics?: (callback: (data: AgentChangeMetrics & AgentRunIdentity) => void) => () => void
  onWorkspaceFileDeleted?: (callback: (data: { filePath: string }) => void) => () => void
  onWorkspaceFileVersionChanged?: (callback: (data: AgentRunIdentity & { filePath: string; contentHash?: string; deleted?: boolean }) => void) => () => void
  onIngestStreamProgress?: (callback: (data: IngestionStreamProgressPayload) => void) => () => void
  onTranslateProgress?: (callback: (data: TranslateProgressPayload) => void) => () => void
  listInstalledSkills: (workspaceRoot?: string) => Promise<SkillDefinition[]>
  listHubSources: () => Promise<SkillHubSource[]>
  addCustomHubSource: (input: CustomHubInput) => Promise<{ success: boolean; source?: SkillHubSource; error?: string }>
  removeCustomHubSource: (sourceId: string) => Promise<{ success: boolean; error?: string }>
  listHubSkillsBySource: (sourceId: string, workspaceRoot?: string, forceRefresh?: boolean) => Promise<HubSkillItem[]>
  listHubSkillsAcrossSources: (workspaceRoot?: string, forceRefresh?: boolean) => Promise<HubSkillItem[]>
  getHubSkillContent: (item: HubSkillItem) => Promise<{ success: boolean; content?: string; error?: string }>
  toggleSkillActive: (skillId: string, isActive: boolean) => Promise<boolean>
  installSkillFromHub: (
    hubSkillId: string,
    workspaceRoot?: string,
    hubSourceId?: string,
  ) => Promise<{ success: boolean; skill?: SkillDefinition; error?: string }>
  installSkillFromUrl: (url: string, workspaceRoot?: string, customName?: string) => Promise<{ success: boolean; skill?: SkillDefinition; error?: string }>
  saveCustomSkill: (input: SkillSaveInput, workspaceRoot?: string) => Promise<{ success: boolean; skill?: SkillDefinition; error?: string }>
  resetSkillToOriginal: (skillId: string, workspaceRoot?: string) => Promise<{ success: boolean; skill?: SkillDefinition; error?: string }>
  uninstallSkill: (skillId: string, workspaceRoot?: string) => Promise<{ success: boolean; error?: string }>
  onOllamaPullProgress?: (callback: (data: OllamaPullProgressEvent) => void) => () => void
  getRunningModels: (host?: string) => Promise<{ success: boolean; models: RunningModelInfo[]; error?: string }>
  unloadModel: (modelName: string, host?: string) => Promise<{ success: boolean; error?: string }>
  /** SLM Agent Studio: trigger log anomaly diagnostics scan and return structured report. */
  agentLogsAnalyze?: (extraPaths?: string[]) => Promise<SlmLogDiagnosticReport>
  /** Pre-flight Clarification Interview: analyze prompt for architectural decisions before drafting plan. */
  agentPlanInterview?: (
    prompt: string,
    model: string | undefined,
    settings: AppSettings,
    workspacePath?: string | null,
    previousDecisions?: UserInterviewAnswer[],
    identity?: AgentRunIdentity,
  ) => Promise<InterviewAnalysisResult>
  /** Enriches prompt with user's confirmed interview answers. */
  agentPlanEnrichPrompt?: (prompt: string, answers: UserInterviewAnswer[], questions: InterviewQuestion[]) => Promise<string>
  /** Plan Approval: draft a canonical structured plan via the backend. */
  agentPlanGenerate?: (
    prompt: string,
    model: string | undefined,
    settings: AppSettings,
    previousPlan?: AgentPlan,
    workspacePath?: string | null,
    previousDecisions?: UserInterviewAnswer[],
    identity?: AgentRunIdentity,
  ) => Promise<PlanGenerationResult>
  agentPlanCancel?: (identity: AgentRunIdentity) => Promise<{ success: boolean }>
  /** Plan Approval: read the backend's persisted plan milestone completion state for a session. */
  agentGetPlanState?: (sessionId: string, workspacePath?: string | null, planRevisionId?: string) => Promise<AgentPlanState | null>
  /** Plan Approval: seed the approved plan's milestones into session state before execution starts. */
  agentPlanSeed?: (
    sessionId: string,
    workspacePath: string | null,
    planMilestones: PlanMilestone[],
    userTask?: string,
    planRevisionId?: string,
  ) => Promise<boolean>
  /** Generates a self-contained AI-optimized debug diagnostic bundle in Markdown. */
  exportAiDebugBundle?: (options: {
    sessionId: string
    workspacePath?: string | null
    settings?: AppSettings
    activeModelName?: string
    activeSkills?: string[]
  }) => Promise<string>
}

// ---------------------------------------------------------------------------
// Pre-flight Clarification Interview Types
// ---------------------------------------------------------------------------

export interface InterviewQuestion {
  id: string
  question: string
  rationale: string
  options: string[]
  recommendedIndex: number
}

export interface InterviewAnalysisResult {
  status: 'completed' | 'clarification_required' | 'error' | 'cancelled'
  hasQuestions: boolean
  questions: InterviewQuestion[]
  rawResponse?: string
  error?: string
}

export interface UserInterviewAnswer {
  questionId: string
  questionText: string
  selectedOption: string
  isCustom?: boolean
  /** How this decision entered the plan; omitted legacy values are explicit answers. */
  provenance?: 'explicit' | 'accepted_recommendation' | 'unconfirmed_assumption'
}

export interface AgentDoneResult {
  success: boolean
  summary: string
  completionStatus?: AgentCompletionStatus
  evidence?: AgentCompletionEvidence
}

/** Execution plan versioned per coding session. */
export interface AgentPlan {
  formatVersion: 2
  id: string
  version: number
  prompt: string
  /** Initial request before interview; `prompt` is effective execution prompt. */
  originalPrompt?: string
  /** Retained decisions independent of rendered prompt. */
  interviewAnswers?: UserInterviewAnswer[]
  objective: string
  decisions: PlanDecision[]
  retainedEvidence: PlanEvidence[]
  supersededWork: PlanSupersededWork[]
  status: 'idle' | 'generating' | 'ready' | 'approved' | 'rejected' | 'error' | 'cancelled'
  errorPhase?: 'interview' | 'planning'
  errorMessage?: string
  createdAt: string
  baseStepOffset?: number
  milestones: PlanMilestone[]
  /** Reason this revision could not be persisted or seeded. */
  approvalError?: string
  capabilityProfile?: AgentCapabilityProfile
}

export interface PlanMilestone {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'verified' | 'failed'
  filePaths?: string[]
  acceptanceCriteria?: string[]
  verificationReferences?: string[]
  sourceInterventionId?: string
  falsifiableHypothesis?: string
  verificationCommand?: string
  /** Scaffolding suggestion, re-verified against project capabilities before execution. */
  proposedVerificationCommand?: string
  /** Content hashes captured when file-backed evidence was verified. */
  fileEvidence?: Record<string, string>
  notes?: string
}

export interface PlanDecision {
  id: string
  statement: string
  source: 'explicit_user' | 'accepted_recommendation' | 'assumption'
  rationale?: string
}

export interface PlanSupersededWork {
  interventionId: string
  reason: string
}

export interface PlanEvidence {
  interventionId: string
  summary: string
  verificationReferences: string[]
}

export interface PlanGenerationResult {
  status: 'success' | 'error'
  objective: string
  decisions: PlanDecision[]
  retainedEvidence: PlanEvidence[]
  milestones: PlanMilestone[]
  supersededWork: PlanSupersededWork[]
  error?: string
}

export interface AgentPlanState {
  planMilestones: PlanMilestone[]
  status?: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
  stepCount: number
  planRevisionId?: string
}

export interface RunningModelDetails {
  parent_model?: string
  format?: string
  family?: string
  families?: string[]
  parameter_size?: string
  quantization_level?: string
}

export interface RunningModelInfo {
  name: string
  model: string
  size: number
  digest?: string
  details?: RunningModelDetails
  expires_at?: string
  size_vram?: number
  /** Context currently allocated by Ollama from `/api/ps`. */
  context_length?: number
}

declare global {
  interface Window {
    electronAPI?: IElectronAPI
  }
}

export interface SlmAnomalyRecord {
  anomaly_type: string
  severity: 'WARNING' | 'ERROR' | 'CRITICAL'
  log_file: string
  line_number: number
  snippet: string
  count: number
  remediation?: string
}

export interface SlmLogDiagnosticReport {
  scanned_files: string[]
  total_lines_scanned: number
  anomalies: SlmAnomalyRecord[]
  has_critical: boolean
  summary: string
}
