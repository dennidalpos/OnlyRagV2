export const DEFAULT_AGENT_STEP_BUDGET = 25
export const MIN_AGENT_STEP_BUDGET = 10
export const MAX_AGENT_STEP_BUDGET = 200

/** Zero is the only unlimited sentinel; 200 is a finite budget. */
export function normalizeAgentStepBudget(value: unknown): number {
  if (value === 0) return 0
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_AGENT_STEP_BUDGET
  return Math.max(MIN_AGENT_STEP_BUDGET, Math.min(MAX_AGENT_STEP_BUDGET, Math.floor(value)))
}
