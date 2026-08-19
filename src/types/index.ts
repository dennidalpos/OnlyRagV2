export interface SystemRequirementsCheck {
  isOsSupported: boolean
  hasMinRam: boolean
  hasRecRam: boolean
  isOllamaReady: boolean
  isGpuAccelerated: boolean
  isSidecarReady?: boolean
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
  }
  ollama: {
    status: 'online' | 'offline' | 'checking'
    url: string
    modelsCount: number
    models: string[]
    /** Per-model metadata from /api/tags' `details` field (parameter_size, quantization_level, ...), when available. */
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
  requirements?: SystemRequirementsCheck
  timestamp: string
}

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

export interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  category: string
}

export type HardwareProfile = 'Low' | 'Medium' | 'High' | 'Auto'

export interface IngestedDocument {
  id: string
  filename: string
  filePath: string
  fileSize: number
  numPages: number
  numChunks: number
  extractedMarkdown: string
  status: 'processing' | 'indexed' | 'error'
  ingestedAt: string
  fileType: 'pdf' | 'image' | 'docx' | 'text'
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
}

export interface ChatMessage {
  id: string
  sender: 'user' | 'bot'
  text: string
  timestamp: string
  sources?: CitationSource[]
  isStreaming?: boolean
}

export interface WorkspaceFile {
  name: string
  path: string
  isDir: boolean
  sizeBytes?: number
}

export interface AgentActionLog {
  id: string
  timestamp: string
  type: 'info' | 'tool_call' | 'terminal' | 'approval_request'
  message: string
  detail?: string
}

import type { ExecutedPrompt, ExecutedPromptOutcome, QueuedPromptRecord, WorkspaceProject } from './workspace'

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
  hardwareProfile: HardwareProfile
  ocrEngine: 'native_cuda' | 'vision_model'
  ollamaHost: string
  customWorkspacePath?: string
  noWorkspaceMode?: boolean
  // Family & Module System Prompt Customizations
  customPromptOverrides?: Record<string, string> // key: `${module}:${family}` -> prompt string
  selectedFamilyOverrides?: Record<string, string> // key: module -> family string or 'auto'
  // Complexity-Based Routing Settings
  useComplexityRouting?: boolean
  complexityFastModel?: string
  complexityStandardModel?: string
  complexityDeepModel?: string
  /** Heavy escalation model (14B+) used when all lighter tiers fail on complex tasks */
  complexityHeavyModel?: string
  // Concurrency & Task Queue Settings
  maxToolCallSteps?: number // Range: 10-200, default 50
  // Coding Agent Audit & Debug Logging
  enableCodingAgentDebugLog?: boolean
  // Plan Approval Settings
  requirePlanApproval?: boolean
  autoProceedPlan?: boolean
  autoProceedDelaySeconds?: number
  // Initial Setup Wizard Flag
  hasCompletedInitialSetup?: boolean
  // Skill Hub Auto-Discovery & On-Demand Installation
  enableSkillRouter?: boolean // Default: true. Set false to completely disable skill injection.
  autoInstallHubSkills?: 'disabled' | 'prompt' | 'auto'
  autoInstallMinScore?: number
  // Internationalization
  language?: 'it' | 'en'
}

/** Aggregate size of the file changes an agent session has applied so far. */
export interface AgentChangeMetrics {
  filesTouched: number
  additions: number
  deletions: number
}

export interface TaskQueueStatus {
  maxConcurrency: number
  runningCount: number
  queuedCount: number
  runningTasks: { id: string; type: string; status: string; createdAt: number }[]
  queuedTasks: { id: string; type: string; status: string; createdAt: number }[]
}

export interface ProjectMapItem {
  path: string
  relativePath: string
  isDir: boolean
  sizeBytes: number
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
  env: {
    PATH: string
    USERPROFILE: string
    OS: string
    PROCESSOR_ARCHITECTURE: string
  }
}

export interface AgentToolReplacementChunk {
  targetContent: string
  replacementContent: string
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
  parameters: Record<string, any>
  explanation?: string
}

export interface CodingSession {
  id: string
  workspacePath: string | null
  title: string
  /** ISO 8601 timestamp. */
  createdAt: string
  /** ISO 8601 timestamp. */
  updatedAt: string
  actionLogs: AgentActionLog[]
  /** Prompts executed in this session, oldest first (see ExecutedPrompt). */
  executedPrompts: ExecutedPrompt[]
  /** Plan versions drafted in this session, oldest first (see AgentPlan). */
  plans?: AgentPlan[]
  promptQueue?: QueuedPromptRecord[]
  pinnedFilePaths?: string[]
}

/** Hub skill the router wants to install while autoInstallHubSkills is set to 'prompt'. */
export interface SkillInstallApprovalRequest {
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
  type: 'progress' | 'done'
  percent: number
  step: string
  pipeline?: string
  page?: number
  total_pages?: number
  fileName?: string
  ocrTechnology?: string
  modelName?: string
  data?: IngestedDocument
}

export interface PagePreviewData {
  docId: string
  pageNumber: number
  totalPages: number
  imageBase64: string
  mimeType: string
}

export interface IElectronAPI {
  runDiagnostics: () => Promise<DiagnosticsData>
  getLogs: () => Promise<LogEntry[]>
  clearLogs: () => Promise<boolean>
  getLogFilePath: () => Promise<string>
  openLogsFolder?: () => Promise<{ success: boolean; path?: string; error?: string }>
  logTelemetry: (level: LogLevel, category: string, message: string) => Promise<boolean>
  pullOllamaModel: (modelName: string) => Promise<{ success: boolean; data?: string; error?: string }>
  cancelPullOllamaModel: () => Promise<{ success: boolean; error?: string }>
  deleteOllamaModel: (modelName: string) => Promise<{ success: boolean; error?: string }>
  installOrLaunchOllama: () => Promise<{ success: boolean; message?: string; error?: string }>
  getSidecarStatus: () => Promise<{ status: string; engine?: string; version?: string; documentsCount?: number; chunksCount?: number }>
  restartSidecar: () => Promise<{ success: boolean; message?: string; error?: string }>
  openFileDialog: (options?: { title?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string[]>
  openDirectoryDialog: (options?: { title?: string }) => Promise<string | null>
  ingestFile: (filePath: string, visionModel?: string, visionPrompt?: string) => Promise<{ success: boolean; data?: IngestedDocument; error?: string }>
  updateIngestedDocument: (docId: string, markdownContent: string) => Promise<{ success: boolean; data?: IngestedDocument; error?: string }>
  translateDocumentInplace: (docId: string, sourceLang: string, targetLang: string, model?: string) => Promise<{ success: boolean; data?: IngestedDocument; error?: string }>
  getDocumentPagePreview: (docId: string, pageNumber: number) => Promise<PagePreviewData | null>
  getIngestedDocuments: () => Promise<IngestedDocument[]>
  deleteIngestedDocument: (docId: string) => Promise<{ success: boolean }>
  searchVectorDb: (query: string, topK?: number, embeddingModel?: string, docIds?: string[]) => Promise<VectorSearchResult[]>
  exportDocument: (markdownContent: string, format: string) => Promise<{ success: boolean; message?: string; error?: string }>
  generateOllamaStream: (model: string, prompt: string, onChunk: (chunk: string) => void, options?: any) => Promise<void>
  cancelOllamaStream: () => Promise<void>
  cancelTask: (taskId?: string) => Promise<{ success: boolean; message?: string }>
  cleanTempResiduals: () => Promise<{ success: boolean; cleanedCount: number; bytesFreed: number }>
  listWorkspaceFiles: (dirPath?: string) => Promise<WorkspaceFile[]>
  getProjectMap: (dirPath: string) => Promise<ProjectMapItem[]>
  readWorkspaceFile: (filePath: string, startLine?: number, endLine?: number) => Promise<{ success: boolean; content?: string; totalLines?: number; startLine?: number; endLine?: number; error?: string }>
  writeWorkspaceFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>
  deleteWorkspaceFile: (filePath: string) => Promise<{ success: boolean; error?: string }>
  replaceWorkspaceFileChunk: (filePath: string, targetContent: string, replacementContent: string) => Promise<{ success: boolean; error?: string }>
  multiReplaceWorkspaceFileChunks: (filePath: string, replacements: AgentToolReplacementChunk[]) => Promise<{ success: boolean; replacedCount?: number; error?: string }>
  grepWorkspaceFiles: (dirPath: string, query: string, isRegex?: boolean, caseInsensitive?: boolean) => Promise<GrepSearchResult[]>
  searchWeb: (query: string, maxResults?: number) => Promise<{ success: boolean; results: { title: string; url: string; snippet: string }[]; error?: string }>
  fetchWebContent: (url: string, maxChars?: number) => Promise<{ success: boolean; content?: string; title?: string; error?: string }>
  downloadFile: (url: string, targetFilePath: string) => Promise<{ success: boolean; downloadedBytes?: number; error?: string }>
  gitCommit: (commitMessage: string, workspaceRoot?: string) => Promise<{ success: boolean; output?: string; error?: string }>
  inspectGuestOsEnvironment: () => Promise<GuestOsInfo>
  executePowerShellCommand: (command: string, cwd?: string, timeoutMs?: number) => Promise<{ success: boolean; output: string; error?: string }>
  parseAgentToolCall: (rawText: string) => Promise<AgentToolCall | null>
  checkDiskSpace: (models: string[]) => Promise<{ allowed: boolean; requiredGB: number; freeGB: number; missingGB: number; error?: string }>
  applyOllamaEnvironmentVariables: (variables: { name: string; value: string }[], restartOllama?: boolean) => Promise<{ success: boolean; appliedCount: number; message: string; error?: string }>
  openExternalUrl?: (url: string) => Promise<boolean>
  startAgentTask: (payload: any) => Promise<{ success: boolean; summary: string; error?: string }>
  cancelAgentTask: (taskId?: string) => Promise<{ success: boolean; message?: string }>
  /** Answers a pending `agent:approval-request`, resuming the paused orchestrator step. */
  respondToAgentApproval?: (sessionId: string, approved: boolean, approvedHunkIndices?: number[]) => Promise<boolean>
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
  removeProjectFromRegistry?: (projectPath: string) => Promise<boolean>
  /** One-shot import of the project list previously persisted in localStorage. */
  migrateLegacyProjects?: (projects: unknown) => Promise<{ migrated: number }>
  /** Fire-and-forget: embeds and upserts one completed prompt into the semantic history index. */
  indexPromptHistory?: (payload: {
    id: string
    sessionId: string
    workspacePath: string
    prompt: string
    summary?: string
    outcome: ExecutedPromptOutcome
    startedAt: string
    completedAt?: string
  }) => Promise<{ success: boolean }>
  /** Semantic search across every indexed project's prompt history. */
  searchPromptHistory?: (query: string, topK?: number, projectPaths?: string[]) => Promise<PromptHistorySearchResult[]>
  onAgentLog: (callback: (log: AgentActionLog) => void) => () => void
  onAgentStepUpdate?: (callback: (data: { step: number; maxSteps: number; maxStepsLabel: string; statusText?: string }) => void) => () => void
  onAgentStreamToken?: (callback: (data: { step: number; chunk: string }) => void) => () => void
  onAgentDone: (callback: (res: { success: boolean; summary: string }) => void) => () => void
  onAgentApprovalRequest: (callback: (req: any) => void) => () => void
  onAgentSkillsMatched?: (callback: (data: { skills: string[] }) => void) => () => void
  /** Skill Hub 'prompt' policy: subscribe to the auto-install confirmation requests. */
  onAgentSkillInstallRequest?: (callback: (req: SkillInstallApprovalRequest) => void) => () => void
  /** Skill Hub 'prompt' policy: answer a pending auto-install confirmation request. */
  respondAgentSkillInstall?: (requestId: string, approved: boolean) => void
  onAgentChangeMetrics?: (callback: (data: AgentChangeMetrics) => void) => () => void
  onWorkspaceFileDeleted?: (callback: (data: { filePath: string }) => void) => () => void
  onIngestDocumentDeleted?: (callback: (data: { docId: string }) => void) => () => void
  onIngestStreamProgress?: (callback: (data: IngestionStreamProgressPayload) => void) => () => void
  benchmarkModel: (modelName: string) => Promise<{ success: boolean; tokensPerSec: number; evalCount: number; evalDurationMs: number; isEmbedding?: boolean; error?: string }>
  listInstalledSkills: (workspaceRoot?: string) => Promise<SkillDefinition[]>
  listHubSources: () => Promise<SkillHubSource[]>
  addCustomHubSource: (input: CustomHubInput) => Promise<{ success: boolean; source?: SkillHubSource; error?: string }>
  removeCustomHubSource: (sourceId: string) => Promise<{ success: boolean; error?: string }>
  listHubSkillsBySource: (sourceId: string, workspaceRoot?: string, forceRefresh?: boolean) => Promise<HubSkillItem[]>
  toggleSkillActive: (skillId: string, isActive: boolean) => Promise<boolean>
  installSkillFromHub: (hubSkillId: string, workspaceRoot?: string, hubSourceId?: string) => Promise<{ success: boolean; skill?: SkillDefinition; error?: string }>
  installSkillFromUrl: (url: string, workspaceRoot?: string, customName?: string) => Promise<{ success: boolean; skill?: SkillDefinition; error?: string }>
  saveCustomSkill: (input: SkillSaveInput, workspaceRoot?: string) => Promise<{ success: boolean; skill?: SkillDefinition; error?: string }>
  resetSkillToOriginal: (skillId: string, workspaceRoot?: string) => Promise<{ success: boolean; skill?: SkillDefinition; error?: string }>
  uninstallSkill: (skillId: string, workspaceRoot?: string) => Promise<{ success: boolean; error?: string }>
  onOllamaPullProgress?: (callback: (data: { modelName: string; status: string; completed?: number; total?: number }) => void) => () => void
  getRunningModels: (host?: string) => Promise<{ success: boolean; models: RunningModelInfo[]; error?: string }>
  unloadModel: (modelName: string, host?: string) => Promise<{ success: boolean; error?: string }>
  /** SLM Agent Studio: trigger log anomaly diagnostics scan and return structured report. */
  agentLogsAnalyze?: (extraPaths?: string[]) => Promise<SlmLogDiagnosticReport | null>
  /** Plan Approval: draft a plan via the backend (hardware-routed), parsed into canonical milestones. */
  agentPlanGenerate?: (prompt: string, model: string | undefined, settings: AppSettings, pendingResidueMilestones?: PlanMilestone[]) => Promise<PlanGenerationResult>
  /** Plan Approval: re-parse (e.g. user-edited) plan text into canonical milestones. */
  agentPlanParseText?: (planText: string) => Promise<PlanMilestone[]>
  /** Plan Approval: read the backend's persisted plan milestone completion state for a session. */
  agentGetPlanState?: (sessionId: string, workspacePath?: string | null) => Promise<AgentPlanState | null>
  /** Plan Approval: seed the approved plan's milestones into session state before execution starts. */
  agentPlanSeed?: (sessionId: string, workspacePath: string | null, planMilestones: PlanMilestone[], userTask?: string) => Promise<boolean>
}

// ---------------------------------------------------------------------------
// Agent Plan — Canonical Milestone Types
// ---------------------------------------------------------------------------

/**
 * A drafted (and possibly approved) execution plan, versioned per coding session.
 * Persisted inside its CodingSession by the session history store.
 */
export interface AgentPlan {
  id: string
  version: number
  prompt: string
  planText: string
  status: 'idle' | 'generating' | 'ready' | 'approved' | 'rejected'
  /** ISO 8601 timestamp. */
  createdAt: string
  baseStepOffset?: number
  /** Canonical milestones parsed by the backend's GoalDecompositionPlanner parser (single source of truth — see PlanPanel). */
  milestones?: PlanMilestone[]
}

export interface PlanMilestone {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'verified' | 'failed'
  falsifiableHypothesis?: string
  verificationCommand?: string
  notes?: string
}

export interface PlanGenerationResult {
  planText: string
  milestones: PlanMilestone[]
}

export interface AgentPlanState {
  planMilestones: PlanMilestone[]
  status?: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
  stepCount: number
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
}

declare global {
  interface Window {
    electronAPI?: IElectronAPI
  }
}

// ---------------------------------------------------------------------------
// SLM Agent Studio — Log Diagnostics Types
// ---------------------------------------------------------------------------

export interface SlmAnomalyRecord {
  anomaly_type: string
  severity: 'WARNING' | 'ERROR' | 'CRITICAL'
  log_file: string
  line_number: number
  snippet: string
  count: number
}

export interface SlmLogDiagnosticReport {
  scanned_files: string[]
  total_lines_scanned: number
  anomalies: SlmAnomalyRecord[]
  has_critical: boolean
  summary: string
}
