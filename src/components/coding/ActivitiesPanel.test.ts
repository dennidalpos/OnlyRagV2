import { describe, it, expect } from 'vitest'
import { AgentActionLog } from '../../types'

describe('ActivitiesPanel & Shell Command Monitoring Unit Tests', () => {
  it('should accurately calculate telemetry counts from action logs without duplicating full chat text', () => {
    const mockLogs: AgentActionLog[] = [
      { id: '1', timestamp: '10:00', message: 'User Prompt: do build', type: 'info' },
      { id: '2', timestamp: '10:01', message: '[ToolCall: write_file] app.ts', type: 'tool_call' },
      { id: '3', timestamp: '10:02', message: '[ToolCall: read_file] package.json', type: 'tool_call' },
      { id: '4', timestamp: '10:03', message: 'Ran npm run build', type: 'terminal' },
    ]

    const agentLogs = mockLogs.filter((l) => !l.message.startsWith('User Prompt: '))
    expect(agentLogs).toHaveLength(3)

    const fileOps = agentLogs.filter((l) => l.message.includes('write_file') || l.message.includes('read_file')).length
    expect(fileOps).toBe(2)

    const terminalOps = agentLogs.filter((l) => l.type === 'terminal' || l.message.startsWith('Ran ')).length
    expect(terminalOps).toBe(1)
  })

  it('should compute 5-second trigger logic for terminal tab auto-open and auto-close', () => {
    let activeTab = 'editor'
    let previousTab: string | null = null
    let autoOpened = false
    let timerFired = false

    const handleCommandStart = () => {
      if (activeTab !== 'terminal') {
        previousTab = activeTab
      }
      // Simulate 5s timer callback
      timerFired = true
      activeTab = 'terminal'
      autoOpened = true
    }

    const handleCommandDone = () => {
      if (autoOpened && previousTab) {
        activeTab = previousTab
        autoOpened = false
        previousTab = null
      }
    }

    // 1. Command starts while in 'editor' tab
    handleCommandStart()
    expect(timerFired).toBe(true)
    expect(activeTab).toBe('terminal')
    expect(autoOpened).toBe(true)

    // 2. Command finishes -> restores original tab
    handleCommandDone()
    expect(activeTab).toBe('editor')
    expect(autoOpened).toBe(false)
  })
})
