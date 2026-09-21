import type { AgentExecutionMode } from '../../types'

const COMPLEX_TASK_PATTERN =
  /\b(refactor|migrat|architecture|end[- ]to[- ]end|multi[- ]file|schema|database|workflow|across\s+(?:the\s+)?(?:repo|project|files)|implement\s+(?:a\s+)?(?:feature|system|module)|build\s+(?:a\s+)?(?:feature|app|application))\b/i
const LIST_ITEM_PATTERN = /^\s*(?:[-*]|\d+[.)])\s+/gm

/** Chooses when the single Run action should enter the planning stage first. */
export function shouldAutomaticallyPlanCodingTask(prompt: string, mode: AgentExecutionMode): boolean {
  if (mode === 'ask') return false
  const normalized = prompt.trim()
  if (!normalized) return false
  const words = normalized.split(/\s+/).length
  const listedSteps = normalized.match(LIST_ITEM_PATTERN)?.length ?? 0
  return words >= 45 || listedSteps >= 2 || COMPLEX_TASK_PATTERN.test(normalized)
}
