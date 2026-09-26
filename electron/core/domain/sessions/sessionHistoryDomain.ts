import type { AgentActionLog, AgentPlan, CodingSession, ExecutedPrompt } from '../../../../shared/types'

/** Prefix used by the agent action log for the entry that records the user prompt. */
export const USER_PROMPT_LOG_PREFIX = 'User Prompt: '

const MAX_TITLE_LENGTH = 48

/** Converts a persisted timestamp to ISO 8601. */
export function toIsoTimestamp(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString()
  }
  return fallback
}

/**
 * Titles earlier versions persisted for a session nobody named, in whichever language was active.
 * They read as untitled, so the renderer can show its own localized default.
 */
const LEGACY_UNTITLED_TITLES = new Set(['Nuova Sessione', 'New Session'])

export function isUntitledSessionTitle(title: string): boolean {
  const clean = title.trim()
  return !clean || LEGACY_UNTITLED_TITLES.has(clean) || clean.startsWith('Session ')
}

/** Session title derived from the first executed prompt, truncated for the sidebar; empty when there is nothing to derive it from. */
export function deriveSessionTitle(prompt: string): string {
  const clean = prompt.replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  return clean.length > MAX_TITLE_LENGTH ? `${clean.slice(0, MAX_TITLE_LENGTH)}...` : clean
}

/** Rebuilds ExecutedPrompt records from an action log. */
export function extractExecutedPromptsFromLogs(sessionId: string, logs: AgentActionLog[], fallbackTimestamp: string): ExecutedPrompt[] {
  return logs
    .filter((log) => typeof log?.message === 'string' && log.message.startsWith(USER_PROMPT_LOG_PREFIX))
    .map((log, index) => ({
      id: `${sessionId}-migrated-${index}`,
      sessionId,
      prompt: log.message.slice(USER_PROMPT_LOG_PREFIX.length).trim(),
      startedAt: toIsoTimestamp(log.timestamp, fallbackTimestamp),
      agentMode: 'guided' as const,
      outcome: 'unknown' as const,
      totalSteps: 0,
      filesTouched: 0,
      additions: 0,
      deletions: 0,
    }))
}

const PLAN_STATUSES: AgentPlan['status'][] = ['idle', 'generating', 'ready', 'approved', 'rejected', 'error', 'cancelled']

/** A persisted JSON object read back from disk: every field is unknown until narrowed. */
type RawRecord = Record<string, unknown>

function asRecord(value: unknown): RawRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RawRecord) : null
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function finiteOr<T>(value: unknown, fallback: T): number | T {
  return Number.isFinite(value) ? Number(value) : fallback
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined
}

function normalizePlan(value: unknown, fallbackTimestamp: string): AgentPlan | null {
  const raw = asRecord(value)
  if (
    !raw ||
    raw.formatVersion !== 2 ||
    typeof raw.id !== 'string' ||
    typeof raw.objective !== 'string' ||
    !Array.isArray(raw.decisions) ||
    !Array.isArray(raw.retainedEvidence) ||
    !Array.isArray(raw.milestones) ||
    !Array.isArray(raw.supersededWork)
  )
    return null
  return {
    formatVersion: 2,
    id: raw.id,
    version: finiteOr(raw.version, 1),
    prompt: optionalString(raw.prompt) ?? '',
    originalPrompt: optionalString(raw.originalPrompt),
    interviewAnswers: Array.isArray(raw.interviewAnswers) ? (raw.interviewAnswers as AgentPlan['interviewAnswers']) : undefined,
    objective: raw.objective,
    // Nested plan content is written by this application and passed through as persisted.
    decisions: raw.decisions as AgentPlan['decisions'],
    retainedEvidence: raw.retainedEvidence as AgentPlan['retainedEvidence'],
    supersededWork: raw.supersededWork as AgentPlan['supersededWork'],
    status: oneOf(raw.status, PLAN_STATUSES) ?? 'ready',
    errorPhase: oneOf(raw.errorPhase, ['interview', 'planning'] as const),
    errorMessage: optionalString(raw.errorMessage),
    createdAt: toIsoTimestamp(raw.createdAt, fallbackTimestamp),
    baseStepOffset: finiteOr(raw.baseStepOffset, undefined),
    milestones: raw.milestones as AgentPlan['milestones'],
    approvalError: optionalString(raw.approvalError),
  }
}

type PromptEvidence = NonNullable<ExecutedPrompt['evidence']>

function normalizePromptEvidence(value: unknown, fallbackTimestamp: string): PromptEvidence | undefined {
  const raw = asRecord(value)
  const cancellationStatus = oneOf(raw?.cancellationStatus, ['not_cancelled', 'rolled_back', 'residual_effects', 'kept'] as const)
  if (!raw || !cancellationStatus) return undefined
  const verification = asRecord(raw.verification)
  const verificationStatus = oneOf(verification?.status, ['verified', 'failed', 'unavailable'] as const)
  return {
    changedFiles: stringsOf(raw.changedFiles),
    verification:
      verification && verificationStatus && typeof verification.checkedAt === 'string'
        ? {
            status: verificationStatus,
            checkedAt: toIsoTimestamp(verification.checkedAt, fallbackTimestamp),
            command: optionalString(verification.command),
            evidenceLevel: oneOf(verification.evidenceLevel, ['structural', 'behavioral'] as const),
            detail: optionalString(verification.detail),
          }
        : undefined,
    cancellationStatus,
    rollbackRestoredFiles: Number.isFinite(raw.rollbackRestoredFiles) ? Math.max(0, Number(raw.rollbackRestoredFiles)) : undefined,
    nonRollbackEffects: stringsOf(raw.nonRollbackEffects),
    ...(typeof raw.checkpointId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(raw.checkpointId) ? { checkpointId: raw.checkpointId } : {}),
  }
}

function normalizeExecutedPrompt(value: unknown, sessionId: string, fallbackTimestamp: string): ExecutedPrompt | null {
  const raw = asRecord(value)
  if (!raw || typeof raw.prompt !== 'string') return null
  const agentMode = oneOf(raw.agentMode, ['ask', 'guided', 'auto'] as const) ?? (raw.agentMode === 'agent' ? 'auto' : 'guided')
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sessionId,
    prompt: raw.prompt,
    startedAt: toIsoTimestamp(raw.startedAt, fallbackTimestamp),
    completedAt: raw.completedAt ? toIsoTimestamp(raw.completedAt, fallbackTimestamp) : undefined,
    agentMode,
    outcome: oneOf(raw.outcome, ['running', 'success', 'failed', 'cancelled'] as const) ?? 'unknown',
    totalSteps: finiteOr(raw.totalSteps, 0),
    filesTouched: finiteOr(raw.filesTouched, 0),
    additions: finiteOr(raw.additions, 0),
    deletions: finiteOr(raw.deletions, 0),
    summary: optionalString(raw.summary),
    completionStatus: oneOf(raw.completionStatus, ['verified', 'unverifiable', 'blocked', 'cancelled'] as const),
    evidence: normalizePromptEvidence(raw.evidence, fallbackTimestamp),
  }
}

function normalizeContextBudget(value: unknown): CodingSession['contextBudget'] {
  const raw = asRecord(value)
  return raw && typeof raw.model === 'string' && Number.isFinite(raw.promptTokens) && Number.isFinite(raw.promptBudgetTokens)
    ? (raw as unknown as CodingSession['contextBudget'])
    : undefined
}

/** Normalizes any persisted or migrated record into a valid CodingSession: ISO 8601 timestamps, an always-present executedPrompts list (rebuilt from the action log when the record predates the entity) and a title derived from the first executed prompt when the us */
export function normalizeSession(value: unknown): CodingSession | null {
  const raw = asRecord(value)
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null
  const sessionId = raw.id

  const fallbackTimestamp = new Date().toISOString()
  const createdAt = toIsoTimestamp(raw.createdAt, fallbackTimestamp)
  const updatedAt = toIsoTimestamp(raw.updatedAt, createdAt)
  const actionLogs: AgentActionLog[] = Array.isArray(raw.actionLogs)
    ? raw.actionLogs
        .map(asRecord)
        .filter((log): log is RawRecord => log !== null && typeof log.message === 'string')
        .map((log) => ({ ...(log as unknown as AgentActionLog), timestamp: toIsoTimestamp(log.timestamp, createdAt) }))
    : []

  const executedPrompts =
    Array.isArray(raw.executedPrompts) && raw.executedPrompts.length > 0
      ? raw.executedPrompts.map((p) => normalizeExecutedPrompt(p, sessionId, createdAt)).filter((p): p is ExecutedPrompt => p !== null)
      : extractExecutedPromptsFromLogs(sessionId, actionLogs, createdAt)

  const plans = Array.isArray(raw.plans)
    ? raw.plans.map((plan) => normalizePlan(plan, createdAt)).filter((plan): plan is AgentPlan => plan !== null)
    : undefined

  const promptQueue = Array.isArray(raw.promptQueue)
    ? raw.promptQueue
        .map(asRecord)
        .filter((item): item is RawRecord & { prompt: string } => item !== null && typeof item.prompt === 'string')
        .map((item) => ({
          id: typeof item.id === 'string' ? item.id : `${sessionId}-queued-${Math.random().toString(36).slice(2, 8)}`,
          prompt: item.prompt,
          createdAt: toIsoTimestamp(item.createdAt, createdAt),
        }))
    : []

  const title = typeof raw.title === 'string' ? raw.title : ''
  const hasCustomTitle = !isUntitledSessionTitle(title)

  return {
    id: sessionId,
    workspacePath: typeof raw.workspacePath === 'string' && raw.workspacePath ? raw.workspacePath : null,
    // '' is the untitled marker: the renderer shows its localized default for it.
    title: hasCustomTitle ? title.trim() : executedPrompts.length > 0 ? deriveSessionTitle(executedPrompts[0].prompt) : '',
    createdAt,
    updatedAt,
    actionLogs,
    executedPrompts,
    plans,
    promptQueue,
    pinnedFilePaths: Array.isArray(raw.pinnedFilePaths) ? stringsOf(raw.pinnedFilePaths) : undefined,
    forceContextCompaction: raw.forceContextCompaction === true,
    contextBudget: normalizeContextBudget(raw.contextBudget),
  }
}

/** Replaces the session with the same id, or prepends it when it is new. */
export function upsertSession(sessions: CodingSession[], session: CodingSession): CodingSession[] {
  const index = sessions.findIndex((s) => s.id === session.id)
  if (index === -1) return [session, ...sessions]
  const next = [...sessions]
  next[index] = session
  return next
}

/** Most recently updated session first. */
export function sortSessionsByRecency(sessions: CodingSession[]): CodingSession[] {
  return [...sessions].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}
