import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { CodingAgentLogger } from './codingAgentLogger'

describe('CodingAgentLogger Unit Tests', () => {
  let loggerInstance: CodingAgentLogger
  let logPath: string

  beforeEach(() => {
    loggerInstance = new CodingAgentLogger()
    logPath = loggerInstance.getLogFilePath()
  })

  it('should format and write session start log entry', () => {
    loggerInstance.logSessionStart('test-session-123', 'Build a React counter component', 'agent', 'qwen2.5-coder:7b', 'D:/Workspace')
    expect(fs.existsSync(logPath)).toBe(true)

    const content = fs.readFileSync(logPath, 'utf-8')
    expect(content).toContain('test-session-123')
    expect(content).toContain('AGENT SESSION START')
    expect(content).toContain('Build a React counter component')
    expect(content).toContain('qwen2.5-coder:7b')
  })

  it('should format and write tool call and tool execution result', () => {
    loggerInstance.logToolCall('test-session-123', 1, 'write_file', { filePath: 'src/Counter.tsx', content: 'export const Counter = () => null' }, 'Creating counter')
    loggerInstance.logToolResult('test-session-123', 1, 'write_file', 'Successfully wrote file src/Counter.tsx')

    const content = fs.readFileSync(logPath, 'utf-8')
    expect(content).toContain('[STEP 1 - TOOL EXECUTION INITIATED] write_file')
    expect(content).toContain('src/Counter.tsx')
    expect(content).toContain('[STEP 1 - TOOL RESULT COMPLETED] write_file')
    expect(content).toContain('Successfully wrote file src/Counter.tsx')
  })

  it('should format and write session completion summary', () => {
    loggerInstance.logSessionEnd('test-session-123', 2, true, 'Counter component created and verified.')

    const content = fs.readFileSync(logPath, 'utf-8')
    expect(content).toContain('[AGENT SESSION END] Session: test-session-123')
    expect(content).toContain('COMPLETED')
    expect(content).toContain('Counter component created and verified.')
  })

  it('should remove session entries when removeSessionFromAuditLog is called', () => {
    loggerInstance.logSessionStart('session-to-delete', 'Task A', 'agent', 'llama3.2')
    loggerInstance.logSessionStart('session-to-keep', 'Task B', 'agent', 'llama3.2')

    expect(fs.readFileSync(logPath, 'utf-8')).toContain('session-to-delete')
    expect(fs.readFileSync(logPath, 'utf-8')).toContain('session-to-keep')

    loggerInstance.removeSessionFromAuditLog('session-to-delete')

    const contentAfter = fs.readFileSync(logPath, 'utf-8')
    expect(contentAfter).not.toContain('session-to-delete')
    expect(contentAfter).toContain('session-to-keep')
  })
})
