import { describe, it, expect } from 'vitest'
import { AgentRuntimeModeFsm } from './agentRuntimeMode'

describe('AgentRuntimeModeFsm', () => {
  it('should initialize with default AGENT mode', () => {
    const fsm = new AgentRuntimeModeFsm()
    expect(fsm.getMode()).toBe('AGENT')
    expect(fsm.isToolAllowed('write_file')).toBe(true)
    expect(fsm.isToolAllowed('run_command')).toBe(true)
  })

  it('should restrict permissions in ASK mode', () => {
    const fsm = new AgentRuntimeModeFsm('ask')
    expect(fsm.getMode()).toBe('ASK')
    expect(fsm.isToolAllowed('read_file')).toBe(true)
    expect(fsm.isToolAllowed('list_dir')).toBe(true)
    expect(fsm.isToolAllowed('write_file')).toBe(false)
    expect(fsm.isToolAllowed('run_command')).toBe(false)
  })

  it('should restrict permissions in PLAN mode', () => {
    const fsm = new AgentRuntimeModeFsm('plan')
    expect(fsm.getMode()).toBe('PLAN')
    expect(fsm.isToolAllowed('grep_search')).toBe(true)
    expect(fsm.isToolAllowed('replace_file_content')).toBe(false)
  })

  it('should allow all execution and diagnostic tools in AGENT mode', () => {
    const fsm = new AgentRuntimeModeFsm('agent')
    expect(fsm.getMode()).toBe('AGENT')
    expect(fsm.isToolAllowed('list_files_recursive')).toBe(true)
    expect(fsm.isToolAllowed('get_file_info')).toBe(true)
    expect(fsm.isToolAllowed('open_in_browser')).toBe(true)
    expect(fsm.isToolAllowed('validate_visual_artifact')).toBe(true)
    expect(fsm.isToolAllowed('run_tests')).toBe(true)
    expect(fsm.isToolAllowed('create_directory')).toBe(true)
    expect(fsm.isToolAllowed('copy_file')).toBe(true)
    expect(fsm.isToolAllowed('move_file')).toBe(true)
    expect(fsm.isToolAllowed('git_status')).toBe(true)
    expect(fsm.isToolAllowed('git_diff')).toBe(true)
  })

  it('should allow read-only exploration and open_in_browser in ASK and PLAN modes', () => {
    const askFsm = new AgentRuntimeModeFsm('ask')
    expect(askFsm.isToolAllowed('list_files_recursive')).toBe(true)
    expect(askFsm.isToolAllowed('get_file_info')).toBe(true)
    expect(askFsm.isToolAllowed('open_in_browser')).toBe(true)
    expect(askFsm.isToolAllowed('validate_visual_artifact')).toBe(true)
    expect(askFsm.isToolAllowed('git_status')).toBe(true)
    expect(askFsm.isToolAllowed('git_diff')).toBe(true)
    expect(askFsm.isToolAllowed('create_directory')).toBe(false)
    expect(askFsm.isToolAllowed('run_command')).toBe(false)

    const planFsm = new AgentRuntimeModeFsm('plan')
    expect(planFsm.isToolAllowed('list_files_recursive')).toBe(true)
    expect(planFsm.isToolAllowed('get_file_info')).toBe(true)
    expect(planFsm.isToolAllowed('open_in_browser')).toBe(true)
    expect(planFsm.isToolAllowed('validate_visual_artifact')).toBe(true)
  })
})
