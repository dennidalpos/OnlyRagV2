import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CodingAgentLogger } from './codingAgentLogger'

describe('CodingAgentLogger Unit Tests', () => {
  let loggerInstance: CodingAgentLogger
  let logPath: string
  let tempDir: string | undefined

  beforeEach(() => {
    loggerInstance = new CodingAgentLogger()
    logPath = loggerInstance.getLogFilePath()
    loggerInstance.clearAuditLog()
  })

  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true })
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

  it('writes the first turn prompt of a session in full as the baseline', () => {
    const prompt = `${'STABLE HEAD '.repeat(60)}
PLAN: step 1`
    loggerInstance.logTurnPrompt('delta-session', 1, 'qwen2.5-coder:7b', 8192, prompt)

    const content = fs.readFileSync(logPath, 'utf-8')
    expect(content).toContain('Baseline: full prompt')
    expect(content).toContain('PLAN: step 1')
  })

  it('elides the prefix a later prompt shares with the previous step', () => {
    const head = 'STABLE HEAD '.repeat(60)
    loggerInstance.logTurnPrompt('elide-session', 1, 'qwen2.5-coder:7b', 8192, `${head}
PLAN: step 1`)
    const afterBaseline = fs.readFileSync(logPath, 'utf-8').length

    loggerInstance.logTurnPrompt('elide-session', 2, 'qwen2.5-coder:7b', 8192, `${head}
PLAN: step 2 with new trajectory`)
    const content = fs.readFileSync(logPath, 'utf-8')
    const secondEntry = content.slice(afterBaseline)

    expect(secondEntry).toContain('Turn Prompt Delta')
    expect(secondEntry).toContain("identical to step 1's prompt")
    expect(secondEntry).toContain('PLAN: step 2 with new trajectory')
    // The whole point: the repeated head is not written a second time.
    expect(secondEntry).not.toContain(head)
  })

  it('writes a diverged prompt in full rather than a misleading delta', () => {
    loggerInstance.logTurnPrompt('diverge-session', 1, 'qwen2.5-coder:7b', 8192, 'A'.repeat(2000))
    const afterBaseline = fs.readFileSync(logPath, 'utf-8').length

    loggerInstance.logTurnPrompt('diverge-session', 2, 'qwen2.5-coder:7b', 8192, 'B'.repeat(2000))
    const secondEntry = fs.readFileSync(logPath, 'utf-8').slice(afterBaseline)

    expect(secondEntry).toContain('Diverged from step 1')
    expect(secondEntry).toContain('B'.repeat(100))
  })

  it('starts a fresh baseline for a session reusing an id after it ended', () => {
    const head = 'STABLE HEAD '.repeat(60)
    loggerInstance.logTurnPrompt('reuse-session', 1, 'qwen2.5-coder:7b', 8192, `${head}
first run`)
    loggerInstance.logSessionEnd('reuse-session', 1, true, 'done')
    const afterEnd = fs.readFileSync(logPath, 'utf-8').length

    loggerInstance.logTurnPrompt('reuse-session', 1, 'qwen2.5-coder:7b', 8192, `${head}
second run`)
    const newEntry = fs.readFileSync(logPath, 'utf-8').slice(afterEnd)

    expect(newEntry).toContain('Baseline: full prompt')
  })

  it('records a milestone transition with the cause that produced it', () => {
    loggerInstance.logMilestoneTransition(
      'transition-session',
      12,
      'm-4',
      'Create src/components/TaskCard.tsx',
      'in_progress',
      'verified',
      'Verified: "src/components/TaskCard.tsx" was written for this milestone.'
    )

    const content = fs.readFileSync(logPath, 'utf-8')
    expect(content).toContain('[STEP 12 - MILESTONE m-4: IN_PROGRESS -> VERIFIED]')
    expect(content).toContain('Create src/components/TaskCard.tsx')
    expect(content).toContain('Cause: Verified: "src/components/TaskCard.tsx" was written for this milestone.')
  })

  it('redacts secrets from agent payloads before persisting them', () => {
    loggerInstance.logToolCall('redaction-session', 1, 'run_command', {
      command: 'curl https://example.test?access_token=secret-value',
      authorization: 'Bearer secret-value',
      password: 'secret-password',
    })

    const content = fs.readFileSync(logPath, 'utf-8')
    expect(content).toContain('[url]')
    expect(content).toContain('[redacted]')
    expect(content).not.toContain('secret-value')
    expect(content).not.toContain('secret-password')
  })

  it('keeps only the configured number of audit-log generations', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-audit-retention-'))
    const retainedPath = path.join(tempDir, 'coding_agent_audit.log')
    const retainedLogger = new CodingAgentLogger({ logFilePath: retainedPath, maxSizeBytes: 1, maxRetainedFiles: 2 })

    retainedLogger.logSessionStart('retention-1', 'first', 'agent', 'model')
    retainedLogger.logSessionStart('retention-2', 'second', 'agent', 'model')
    retainedLogger.logSessionStart('retention-3', 'third', 'agent', 'model')

    expect(fs.existsSync(retainedPath)).toBe(true)
    expect(fs.existsSync(path.join(tempDir, 'coding_agent_audit.1.log'))).toBe(true)
    expect(fs.existsSync(path.join(tempDir, 'coding_agent_audit.2.log'))).toBe(false)
  })
})
