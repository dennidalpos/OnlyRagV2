import type { AgentActionLog, AgentPlan, CodingSession, ExecutedPrompt } from '../../../../src/types'

/** Prefix used by the agent action log for the entry that records the user prompt. */
export const USER_PROMPT_LOG_PREFIX = 'User Prompt: '

const MAX_TITLE_LENGTH = 48

/**
 * Converts a persisted timestamp to ISO 8601. Legacy records were written with
 * `toLocaleTimeString` ("14:32"), which `new Date(...)` cannot parse and which
 * rendered as "Invalid Date" in the history UI; those values are unrecoverable
 * and fall back to the supplied reference date.
 */
export function toIsoTimestamp(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString()
  }
  return fallback
}

/** Session title derived from the first executed prompt, truncated for the sidebar. */
export function deriveSessionTitle(prompt: string): string {
  const clean = prompt.replace(/\s+/g, ' ').trim()
  if (!clean) return 'Nuova Sessione'
  return clean.length > MAX_TITLE_LENGTH ? `${clean.slice(0, MAX_TITLE_LENGTH)}...` : clean
}

/**
 * Rebuilds ExecutedPrompt records from an action log. Used only to migrate legacy
 * sessions, which persisted prompts exclusively as "User Prompt: ..." log lines and
 * therefore carry no per-prompt outcome or change metrics.
 */
export function extractExecutedPromptsFromLogs(
  sessionId: string,
  logs: AgentActionLog[],
  fallbackTimestamp: string
): ExecutedPrompt[] {
  return logs
    .filter((log) => typeof log?.message === 'string' && log.message.startsWith(USER_PROMPT_LOG_PREFIX))
    .map((log, index) => ({
      id: `${sessionId}-migrated-${index}`,
      sessionId,
      prompt: log.message.slice(USER_PROMPT_LOG_PREFIX.length).trim(),
      startedAt: toIsoTimestamp(log.timestamp, fallbackTimestamp),
      agentMode: 'agent' as const,
      outcome: 'unknown' as const,
      totalSteps: 0,
      filesTouched: 0,
      additions: 0,
      deletions: 0,
    }))
}

const PLAN_STATUSES: AgentPlan['status'][] = ['idle', 'generating', 'ready', 'approved', 'rejected']

function normalizePlan(raw: any, fallbackTimestamp: string): AgentPlan | null {
  if (!raw || typeof raw.id !== 'string' || typeof raw.planText !== 'string') return null
  return {
    id: raw.id,
    version: Number.isFinite(raw.version) ? Number(raw.version) : 1,
    prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
    planText: raw.planText,
    status: PLAN_STATUSES.includes(raw.status) ? raw.status : 'ready',
    createdAt: toIsoTimestamp(raw.createdAt, fallbackTimestamp),
    baseStepOffset: Number.isFinite(raw.baseStepOffset) ? Number(raw.baseStepOffset) : undefined,
    milestones: Array.isArray(raw.milestones) ? raw.milestones : undefined,
  }
}

function normalizeExecutedPrompt(raw: any, sessionId: string, fallbackTimestamp: string): ExecutedPrompt | null {
  if (!raw || typeof raw.prompt !== 'string') return null
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sessionId,
    prompt: raw.prompt,
    startedAt: toIsoTimestamp(raw.startedAt, fallbackTimestamp),
    completedAt: raw.completedAt ? toIsoTimestamp(raw.completedAt, fallbackTimestamp) : undefined,
    agentMode: raw.agentMode === 'plan' || raw.agentMode === 'ask' ? raw.agentMode : 'agent',
    outcome: ['running', 'success', 'failed', 'cancelled'].includes(raw.outcome) ? raw.outcome : 'unknown',
    totalSteps: Number.isFinite(raw.totalSteps) ? Number(raw.totalSteps) : 0,
    filesTouched: Number.isFinite(raw.filesTouched) ? Number(raw.filesTouched) : 0,
    additions: Number.isFinite(raw.additions) ? Number(raw.additions) : 0,
    deletions: Number.isFinite(raw.deletions) ? Number(raw.deletions) : 0,
    summary: typeof raw.summary === 'string' ? raw.summary : undefined,
  }
}

/**
 * Normalizes any persisted or migrated record into a valid CodingSession:
 * ISO 8601 timestamps, an always-present executedPrompts list (rebuilt from the
 * action log when the record predates the entity) and a title derived from the
 * first executed prompt when the user never renamed the session.
 */
export function normalizeSession(raw: any): CodingSession | null {
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null

  const fallbackTimestamp = new Date().toISOString()
  const createdAt = toIsoTimestamp(raw.createdAt, fallbackTimestamp)
  const updatedAt = toIsoTimestamp(raw.updatedAt, createdAt)
  const actionLogs: AgentActionLog[] = Array.isArray(raw.actionLogs)
    ? raw.actionLogs
        .filter((log: any) => log && typeof log.message === 'string')
        .map((log: any) => ({ ...log, timestamp: toIsoTimestamp(log.timestamp, createdAt) }))
    : []

  const executedPrompts = Array.isArray(raw.executedPrompts) && raw.executedPrompts.length > 0
    ? raw.executedPrompts
        .map((p: any) => normalizeExecutedPrompt(p, raw.id, createdAt))
        .filter((p: ExecutedPrompt | null): p is ExecutedPrompt => p !== null)
    : extractExecutedPromptsFromLogs(raw.id, actionLogs, createdAt)

  const plans = Array.isArray(raw.plans)
    ? raw.plans
        .map((plan: any) => normalizePlan(plan, createdAt))
        .filter((plan: AgentPlan | null): plan is AgentPlan => plan !== null)
    : undefined

  const promptQueue = Array.isArray(raw.promptQueue)
    ? raw.promptQueue
        .filter((item: any) => item && typeof item.prompt === 'string')
        .map((item: any) => ({
          id: typeof item.id === 'string' ? item.id : `${raw.id}-queued-${Math.random().toString(36).slice(2, 8)}`,
          prompt: item.prompt,
          createdAt: toIsoTimestamp(item.createdAt, createdAt),
        }))
    : []

  const hasCustomTitle =
    typeof raw.title === 'string' &&
    raw.title.trim().length > 0 &&
    raw.title !== 'Nuova Sessione' &&
    raw.title !== 'New Session' &&
    !raw.title.startsWith('Session ')

  return {
    id: raw.id,
    workspacePath: typeof raw.workspacePath === 'string' && raw.workspacePath ? raw.workspacePath : null,
    title: hasCustomTitle
      ? raw.title.trim()
      : executedPrompts.length > 0
        ? deriveSessionTitle(executedPrompts[0].prompt)
        : 'Nuova Sessione',
    createdAt,
    updatedAt,
    actionLogs,
    executedPrompts,
    plans,
    promptQueue,
    pinnedFilePaths: Array.isArray(raw.pinnedFilePaths) ? raw.pinnedFilePaths.filter((p: any) => typeof p === 'string') : undefined,
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
