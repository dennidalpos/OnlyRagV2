import { describe, expect, it } from 'vitest'
import { AgentExecutionPhaseController } from './agentExecutionPhase'

describe('AgentExecutionPhaseController', () => {
  it('runs the application-owned phase sequence', () => {
    const controller = new AgentExecutionPhaseController()
    expect(controller.getPhase()).toBe('collect_context')

    for (const phase of ['propose_action', 'apply_action', 'verify', 'collect_context', 'outcome'] as const) {
      controller.transition(phase)
    }
    expect(controller.getPhase()).toBe('outcome')
  })

  it('allows rejected proposals to return to context collection', () => {
    const controller = new AgentExecutionPhaseController()
    controller.transition('propose_action')
    controller.transition('collect_context')
    expect(controller.getPhase()).toBe('collect_context')
  })

  it('rejects skipped or post-terminal transitions', () => {
    const controller = new AgentExecutionPhaseController()
    expect(() => controller.transition('verify')).toThrow(/collect_context -> verify/)
    controller.transition('outcome')
    expect(() => controller.transition('collect_context')).toThrow(/outcome -> collect_context/)
  })
})
