import { describe, expect, it } from 'vitest'
import type { AgentGuardEvent } from '../../../../shared/types'
import { MAX_GUARD_EVENTS, guardForLoopPattern, recordGuardEvent } from './agentGuardEvents'

describe('agent guard events', () => {
  it('keeps only the most recent MAX_GUARD_EVENTS firings', () => {
    const events: AgentGuardEvent[] = []
    for (let step = 1; step <= MAX_GUARD_EVENTS + 5; step++) recordGuardEvent(events, 'no_mutation', 'advise', step)

    expect(events).toHaveLength(MAX_GUARD_EVENTS)
    expect(events[0].step).toBe(6)
    expect(events.at(-1)).toEqual({ guard: 'no_mutation', action: 'advise', step: MAX_GUARD_EVENTS + 5 })
  })

  it('maps every loop pattern to its own guard id', () => {
    expect(guardForLoopPattern('exact_repeat')).toBe('loop_exact_repeat')
    expect(guardForLoopPattern('cycle')).toBe('loop_cycle')
    expect(guardForLoopPattern('same_file_edits')).toBe('loop_same_file_edits')
    expect(guardForLoopPattern('same_target_reads')).toBe('loop_same_target_reads')
    expect(guardForLoopPattern('unchanged_failing_repeat')).toBe('loop_unchanged_failure')
  })
})
