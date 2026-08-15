import { describe, it, expect } from 'vitest'
import { AgentRuntimeModeFsm, MODE_PERMISSIONS } from './agentRuntimeMode'

describe('AgentRuntimeModeFsm', () => {
  it('should initialize with default AGENT mode', () => {
    const fsm = new AgentRuntimeModeFsm()
    expect(fsm.getMode()).toBe('AGENT')
    expect(fsm.canModifyFiles()).toBe(true)
    expect(fsm.canExecuteCommands()).toBe(true)
  })

  it('should restrict permissions in ASK mode', () => {
    const fsm = new AgentRuntimeModeFsm('ask')
    expect(fsm.getMode()).toBe('ASK')
    expect(fsm.canModifyFiles()).toBe(false)
    expect(fsm.canExecuteCommands()).toBe(false)
    expect(fsm.isToolAllowed('read_file')).toBe(true)
    expect(fsm.isToolAllowed('list_dir')).toBe(true)
    expect(fsm.isToolAllowed('write_file')).toBe(false)
    expect(fsm.isToolAllowed('run_command')).toBe(false)
  })

  it('should restrict permissions in PLAN mode', () => {
    const fsm = new AgentRuntimeModeFsm('plan')
    expect(fsm.getMode()).toBe('PLAN')
    expect(fsm.canModifyFiles()).toBe(false)
    expect(fsm.canExecuteCommands()).toBe(false)
    expect(fsm.isToolAllowed('grep_search')).toBe(true)
    expect(fsm.isToolAllowed('replace_file_content')).toBe(false)
  })

  it('should allow mode switching', () => {
    const fsm = new AgentRuntimeModeFsm('ask')
    expect(fsm.getMode()).toBe('ASK')

    fsm.setMode('agent')
    expect(fsm.getMode()).toBe('AGENT')
    expect(fsm.canModifyFiles()).toBe(true)
    expect(fsm.isToolAllowed('run_command')).toBe(true)
  })

  it('should correctly filter a list of tools according to active mode', () => {
    const fsm = new AgentRuntimeModeFsm('ask')
    const allTools = ['read_file', 'write_file', 'run_command', 'grep_search'] as const
    const filtered = fsm.filterAllowedTools(allTools as any)
    expect(filtered).toEqual(['read_file', 'grep_search'])
  })
})
