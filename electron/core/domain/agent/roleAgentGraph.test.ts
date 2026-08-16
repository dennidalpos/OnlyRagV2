import { describe, it, expect } from 'vitest'
import { RoleBasedAgentGraphOrchestrator } from './roleAgentGraph'

describe('RoleBasedAgentGraphOrchestrator', () => {
  it('should initialize with PLANNER role', () => {
    const orchestrator = new RoleBasedAgentGraphOrchestrator('Build feature X')
    expect(orchestrator.currentState.currentRole).toBe('PLANNER')
  })

  it('should restrict tools by active role', () => {
    const orchestrator = new RoleBasedAgentGraphOrchestrator('Build feature X')
    const plannerCfg = orchestrator.getRoleConfiguration('PLANNER')
    expect(plannerCfg.allowedTools).toContain('read_file')
    expect(plannerCfg.allowedTools).not.toContain('write_file')

    const coderCfg = orchestrator.getRoleConfiguration('CODER')
    expect(coderCfg.allowedTools).toContain('write_file')
    expect(coderCfg.allowedTools).toContain('replace_file_content')
  })

  it('should transition between roles based on events', () => {
    const orchestrator = new RoleBasedAgentGraphOrchestrator('Refactor module Y')
    expect(orchestrator.transitionState('PLAN_CREATED')).toBe('EXPLORER')
    expect(orchestrator.transitionState('EXPLORATION_DONE')).toBe('CODER')
    expect(orchestrator.transitionState('CODE_APPLIED')).toBe('VERIFIER')
    expect(orchestrator.transitionState('VERIFICATION_FAILED')).toBe('CODER')
  })
})
