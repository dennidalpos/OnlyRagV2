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

import type { AgentCompletionEvidence, AgentCompletionStatus, ExecutedPrompt, ExecutedPromptOutcome, QueuedPromptRecord } from './workspace'
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

/** An agent action waiting for the user's approval, as Main sends it on `agent:approval-request`. */
export interface AgentApprovalRequest extends AgentRunIdentity {
  sessionId: string
  type: 'write_file' | 'replace_chunk' | 'multi_replace' | 'delete_file' | 'download_file' | 'terminal_cmd' | 'git_commit' | 'publish_workspace'
  target: string
  contentOrCmd: string
  replacement?: string
  replacements?: { targetContent: string; replacementContent: string }[]
  parameters?: Record<string, UntrustedJson>
  /** Why one review covers the step (workspace mutation, network access, installation, Guided review). */
  reasons?: string[]
}

/** What an orchestrator step asks the user to approve; Main adds the run identity and session. */
export type AgentApprovalPayload = Omit<AgentApprovalRequest, keyof AgentRunIdentity | 'sessionId'>

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
