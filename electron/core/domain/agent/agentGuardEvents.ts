import type { AgentGuardAction, AgentGuardEvent, AgentGuardId } from '../../../../shared/types'
import type { LoopPattern } from './loopDetector'

/** Bound on the per-run guard record kept in memory, persisted state and completion evidence. */
export const MAX_GUARD_EVENTS = 100

/** Appends a guard firing, dropping the oldest entries beyond MAX_GUARD_EVENTS. */
export function recordGuardEvent(events: AgentGuardEvent[], guard: AgentGuardId, action: AgentGuardAction, step: number): void {
  events.push({ guard, action, step })
  if (events.length > MAX_GUARD_EVENTS) events.splice(0, events.length - MAX_GUARD_EVENTS)
}

export function guardForLoopPattern(pattern: LoopPattern | undefined): AgentGuardId {
  if (pattern === 'shell_tool_confusion') return 'shell_tool_confusion'
  if (pattern === 'cycle') return 'loop_cycle'
  if (pattern === 'unchanged_failing_repeat') return 'loop_unchanged_failure'
  if (pattern === 'same_file_edits') return 'loop_same_file_edits'
  if (pattern === 'same_target_reads') return 'loop_same_target_reads'
  return 'loop_exact_repeat'
}
