import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CodingAgentLogger } from './codingAgentLogger'

describe('CodingAgentLogger Unit Tests', () => {
  let loggerInstance: CodingAgentLogger
  let logPath: string
  let tempDir: string | undefined

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-audit-test-'))
    loggerInstance = new CodingAgentLogger({ logFilePath: path.join(tempDir, 'coding_agent_audit.log') })
    logPath = loggerInstance.getLogFilePath()
  })

  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true })
    tempDir = undefined
  })

  it('defaults session audit entries to metadata without prompt or workspace payloads', () => {
    loggerInstance.logSessionStart('test-session-123', 'Build a React counter component', 'agent', 'qwen2.5-coder:7b', 'D:/Workspace')
    expect(fs.existsSync(logPath)).toBe(true)

    const content = fs.readFileSync(logPath, 'utf-8')
    expect(content).toContain('test-session-123')
    expect(content).toContain('AGENT SESSION START')
    expect(content).toContain('User Task: [payload omitted]')
    expect(content).toContain('Workspace Path: [payload omitted]')
    expect(content).not.toContain('Build a React counter component')
    expect(content).not.toContain('D:/Workspace')
    expect(content).toContain('qwen2.5-coder:7b')
  })

  it('should format and write tool call and tool execution result', () => {
    loggerInstance.logSessionStart('test-session-123', 'Task', 'auto', 'model', null, true)
    loggerInstance.logToolCall(
      'test-session-123',
      1,
      'write_file',
      { filePath: 'src/Counter.tsx', content: 'export const Counter = () => null' },
      'Creating counter',
    )
    loggerInstance.logToolResult('test-session-123', 1, 'write_file', 'Successfully wrote file src/Counter.tsx')

    const content = fs.readFileSync(logPath, 'utf-8')
    expect(content).toContain('[STEP 1 - TOOL EXECUTION INITIATED] write_file')
    expect(content).toContain('src/Counter.tsx')
    expect(content).toContain('[STEP 1 - TOOL RESULT COMPLETED] write_file')
    expect(content).toContain('Successfully wrote file src/Counter.tsx')
  })

  it('keeps planning errors and paths visible while redacting credentials', () => {
    loggerInstance.logSessionStart('planning-session', 'Fix src/App.tsx', 'guided', 'model', 'D:/Workspace', true)
    loggerInstance.logPlanningStep('planning-session', 'REQUEST LEDGER VALIDATION 1', 'Invalid source lines: OBL-001; token=private-key')

    const content = fs.readFileSync(logPath, 'utf-8')
    expect(content).toContain('Fix src/App.tsx')
    expect(content).toContain('D:/Workspace')
    expect(content).toContain('Invalid source lines: OBL-001')
    expect(content).toContain('token=[redacted]')
    expect(content).not.toContain('private-key')
  })

  it('records turn-policy denials as failed tool results', () => {
    loggerInstance.logToolCall('policy-session', 1, 'write_file', { filePath: 'src/App.tsx' })
    loggerInstance.logToolResult('policy-session', 1, 'write_file', '[TURN TOOL POLICY DENIED] Tool "write_file" is not available for this phase.')
    loggerInstance.logSessionEnd('policy-session', 1, false, 'Tool denied by turn policy.')

    const content = fs.readFileSync(logPath, 'utf-8')
    expect(content).toContain('[STEP 1 - TOOL RESULT FAILED] write_file')
    expect(content).toContain('Succeeded: false')
    expect(content).toContain('Status: STOPPED/FAILED')
  })

  it('keeps tool parameters, results, and model output out of metadata-only logs', () => {
    loggerInstance.logSessionStart('metadata-session', 'private task', 'guided', 'model', 'D:/Private')
    loggerInstance.logToolCall('metadata-session', 1, 'write_file', { filePath: 'secret.ts', content: 'private source' })
    loggerInstance.logToolResult('metadata-session', 1, 'write_file', 'private result')
    loggerInstance.logLlmResponse('metadata-session', 1, 'private model output')

    const content = fs.readFileSync(logPath, 'utf-8')
    expect(content).toContain('Tool Parameters: [payload omitted]')
    expect(content).toContain('Tool Result: [payload omitted]')
    expect(content).toContain('LLM Streamed Output: [payload omitted]')
    expect(content).not.toContain('secret.ts')
    expect(content).not.toContain('private source')
    expect(content).not.toContain('private result')
    expect(content).not.toContain('private model output')
  })

  it('should format and write session completion summary', () => {
    loggerInstance.logSessionStart('test-session-123', 'Task', 'auto', 'model', null, true)
    loggerInstance.logSessionEnd('test-session-123', 2, true, 'Counter component created and verified.')

    const content = fs.readFileSync(logPath, 'utf-8')
    expect(content).toContain('[AGENT SESSION END] Session: test-session-123')
    expect(content).toContain('COMPLETED')
    expect(content).toContain('Counter component created and verified.')
  })

  it('writes per-session run metrics without carrying counters into another session', () => {
    loggerInstance.logToolCall('metrics-a', 1, 'write_file', { filePath: 'a.txt' })
    loggerInstance.logToolResult('metrics-a', 1, 'write_file', 'Successfully wrote file a.txt')
    loggerInstance.logToolResult('metrics-a', 2, 'unparsed_tool', '[TOOL PARSER REJECTION DIAGNOSTIC]')
    loggerInstance.logSessionEnd('metrics-a', 2, false, 'stopped')
    loggerInstance.logSessionEnd('metrics-b', 0, true, 'done')

    const content = fs.readFileSync(logPath, 'utf-8')
    expect(content).toContain('"sessionId": "metrics-a"')
    expect(content).toContain('"toolCalls": 1')
    expect(content).toContain('"invalidToolCalls": 1')
    expect(content).toContain('"sessionId": "metrics-b"')
    expect(content).toContain('"toolCalls": 0')
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
    loggerInstance.logSessionStart('delta-session', 'Task', 'auto', 'model', null, true)
    const prompt = `${'STABLE HEAD '.repeat(60)}
PLAN: step 1`
    loggerInstance.logTurnPrompt('delta-session', 1, 'qwen2.5-coder:7b', 8192, prompt)

    const content = fs.readFileSync(logPath, 'utf-8')
    expect(content).toContain('Baseline: full prompt')
    expect(content).toContain('PLAN: step 1')
  })

  it('elides the prefix a later prompt shares with the previous step', () => {
    loggerInstance.logSessionStart('elide-session', 'Task', 'auto', 'model', null, true)
    const head = 'STABLE HEAD '.repeat(60)
    loggerInstance.logTurnPrompt(
      'elide-session',
      1,
      'qwen2.5-coder:7b',
      8192,
      `${head}
PLAN: step 1`,
    )
    const afterBaseline = fs.readFileSync(logPath, 'utf-8').length

    loggerInstance.logTurnPrompt(
      'elide-session',
      2,
      'qwen2.5-coder:7b',
      8192,
      `${head}
PLAN: step 2 with new trajectory`,
    )
    const content = fs.readFileSync(logPath, 'utf-8')
    const secondEntry = content.slice(afterBaseline)

    expect(secondEntry).toContain('Turn Prompt Delta')
    expect(secondEntry).toContain("identical to step 1's prompt")
    expect(secondEntry).toContain('PLAN: step 2 with new trajectory')
    // The whole point: the repeated head is not written a second time.
    expect(secondEntry).not.toContain(head)
  })

  it('writes a diverged prompt in full rather than a misleading delta', () => {
    loggerInstance.logSessionStart('diverge-session', 'Task', 'auto', 'model', null, true)
    loggerInstance.logTurnPrompt('diverge-session', 1, 'qwen2.5-coder:7b', 8192, 'A'.repeat(2000))
    const afterBaseline = fs.readFileSync(logPath, 'utf-8').length

    loggerInstance.logTurnPrompt('diverge-session', 2, 'qwen2.5-coder:7b', 8192, 'B'.repeat(2000))
    const secondEntry = fs.readFileSync(logPath, 'utf-8').slice(afterBaseline)

    expect(secondEntry).toContain('Diverged from step 1')
    expect(secondEntry).toContain('B'.repeat(100))
  })

  it('starts a fresh baseline for a session reusing an id after it ended', () => {
    loggerInstance.logSessionStart('reuse-session', 'Task', 'auto', 'model', null, true)
    const head = 'STABLE HEAD '.repeat(60)
    loggerInstance.logTurnPrompt(
      'reuse-session',
      1,
      'qwen2.5-coder:7b',
      8192,
      `${head}
first run`,
    )
    loggerInstance.logSessionEnd('reuse-session', 1, true, 'done')
    const afterEnd = fs.readFileSync(logPath, 'utf-8').length

    loggerInstance.logSessionStart('reuse-session', 'Task', 'auto', 'model', null, true)
    loggerInstance.logTurnPrompt(
      'reuse-session',
      1,
      'qwen2.5-coder:7b',
      8192,
      `${head}
second run`,
    )
    const newEntry = fs.readFileSync(logPath, 'utf-8').slice(afterEnd)

    expect(newEntry).toContain('Baseline: full prompt')
  })

  it('records a milestone transition with the cause that produced it', () => {
    loggerInstance.logSessionStart('transition-session', 'Task', 'auto', 'model', null, true)
    loggerInstance.logMilestoneTransition(
      'transition-session',
      12,
      'm-4',
      'Create src/components/TaskCard.tsx',
      'in_progress',
      'verified',
      'Verified: "src/components/TaskCard.tsx" was written for this milestone.',
    )

    const content = fs.readFileSync(logPath, 'utf-8')
    expect(content).toContain('[STEP 12 - MILESTONE m-4: IN_PROGRESS -> VERIFIED]')
    expect(content).toContain('Create src/components/TaskCard.tsx')
    expect(content).toContain('Cause: Verified: "src/components/TaskCard.tsx" was written for this milestone.')
  })

  it('redacts secrets from agent payloads before persisting them', () => {
    loggerInstance.logSessionStart('redaction-session', 'Task', 'auto', 'model', null, true)
    loggerInstance.logToolCall('redaction-session', 1, 'run_command', {
      command: 'curl https://example.test?access_token=secret-value',
      authorization: 'Bearer secret-value',
      password: 'secret-password',
    })

    const content = fs.readFileSync(logPath, 'utf-8')
    expect(content).toContain('https://example.test?access_token=[redacted]')
    expect(content).toContain('[redacted]')
    expect(content).not.toContain('secret-value')
    expect(content).not.toContain('secret-password')
  })

  it('mirrors entries with error details kept and credentials removed when a live run asks for it', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-audit-mirror-'))
    const mirrorPath = path.join(tempDir, 'audit', 'unredacted.log')
    const mirrored = new CodingAgentLogger({ logFilePath: path.join(tempDir, 'coding_agent_audit.log') })
    mirrored.mirrorUnredactedTo(mirrorPath)
    mirrored.logSessionStart('mirror-session', 'Task', 'auto', 'model', null, true)
    mirrored.logToolResult(
      'mirror-session',
      3,
      'run_command',
      'Error: ReferenceError: App is not defined\nLast useful error: vite build failed: token=secret-value',
    )

    const redacted = fs.readFileSync(path.join(tempDir, 'coding_agent_audit.log'), 'utf-8')
    const unredacted = fs.readFileSync(mirrorPath, 'utf-8')
    expect(redacted).toContain('ReferenceError: App is not defined')
    expect(redacted).toContain('Last useful error: vite build failed')
    expect(redacted).not.toContain('secret-value')
    expect(unredacted).toContain('ReferenceError: App is not defined')
    expect(unredacted).toContain('Last useful error: vite build failed')
    expect(unredacted).not.toContain('secret-value')

    mirrored.mirrorUnredactedTo(null)
    mirrored.logSessionEnd('mirror-session', 3, false, 'stopped')
    expect(fs.readFileSync(mirrorPath, 'utf-8')).toBe(unredacted)
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

  it('reads every retained step in order across rotation and restart with reconstructible prompt deltas', () => {
    const retained = new CodingAgentLogger({ logFilePath: logPath, maxSizeBytes: 1800, maxRetainedFiles: 3 })
    const head = `${'STABLE HEAD '.repeat(55)}\n`
    retained.logSessionStart('audit-run', 'Build a widget', 'auto', 'model', null, true)
    retained.logTurnPrompt('audit-run', 1, 'model', 8192, `${head}PLAN: step 1`)
    retained.logTurnPrompt('audit-run', 2, 'model', 8192, `${head}PLAN: step 2`)
    retained.logLlmResponse('audit-run', 2, `MODEL STEP 2 ${'x'.repeat(1000)}`)
    retained.logToolResult('audit-run', 2, 'read_file', 'RESULT STEP 2')
    retained.logTurnPrompt('audit-run', 3, 'model', 8192, `${head}PLAN: step 3`)
    retained.logPlanningStep('audit-run', 'ERROR', 'Planning failed: invalid ledger source')

    const restarted = new CodingAgentLogger({ logFilePath: logPath, maxSizeBytes: 1800, maxRetainedFiles: 3 })
    const readback = restarted.readSessionAuditLog('audit-run')
    expect(fs.existsSync(path.join(tempDir!, 'coding_agent_audit.1.log'))).toBe(true)
    expect(readback).toContain('PLAN: step 1')
    expect(readback).toContain('PLAN: step 2')
    expect(readback).toContain('MODEL STEP 2')
    expect(readback).toContain('Turn Prompt Delta:')
    expect(readback).toContain('RESULT STEP 2')
    expect(readback).toContain('PLAN: step 3')
    expect(readback).toContain('Planning failed: invalid ledger source')
    expect(readback.indexOf('PLAN: step 1')).toBeLessThan(readback.indexOf('PLAN: step 2'))
    expect(readback.indexOf('PLAN: step 2')).toBeLessThan(readback.indexOf('MODEL STEP 2'))
    expect(readback.indexOf('MODEL STEP 2')).toBeLessThan(readback.indexOf('RESULT STEP 2'))
    expect(readback.indexOf('RESULT STEP 2')).toBeLessThan(readback.indexOf('PLAN: step 3'))
    const retainedFiles = ['coding_agent_audit.2.log', 'coding_agent_audit.1.log', 'coding_agent_audit.log']
      .filter((name) => fs.existsSync(path.join(tempDir!, name)))
      .map((name) => fs.readFileSync(path.join(tempDir!, name), 'utf-8'))
    for (const file of retainedFiles) {
      const firstPrompt = file.match(/\[STEP \d+ - PROMPT SENT TO LLM\][\s\S]*?(?=\n={80}\n\[|$)/)
      if (firstPrompt) expect(firstPrompt[0]).toContain('Turn Prompt Payload:')
    }
  })

  it('clears current and rotated logs and starts a new prompt baseline', () => {
    const retained = new CodingAgentLogger({ logFilePath: logPath, maxSizeBytes: 700, maxRetainedFiles: 3 })
    const head = `${'STABLE HEAD '.repeat(55)}\n`
    retained.logSessionStart('clear-run', 'private task', 'auto', 'model', null, true)
    retained.logTurnPrompt('clear-run', 1, 'model', 8192, `${head}old step`)
    retained.logLlmResponse('clear-run', 1, 'private response')
    expect(fs.existsSync(path.join(tempDir!, 'coding_agent_audit.1.log'))).toBe(true)

    expect(retained.clearAuditLog()).toBe(true)
    expect(retained.readSessionAuditLog('clear-run')).toBe('')
    retained.logSessionStart('clear-run', 'new task', 'auto', 'model', null, true)
    retained.logTurnPrompt('clear-run', 2, 'model', 8192, `${head}new step`)
    const readback = retained.readSessionAuditLog('clear-run')
    expect(readback).toContain('Baseline: full prompt')
    expect(readback).toContain('new step')
    expect(readback).not.toContain('old step')
    expect(readback).not.toContain('private response')
  })

  it('keeps a separator inside a payload and does not attribute another session mentioned there', () => {
    loggerInstance.logSessionStart('audit-a', 'Task A', 'auto', 'model', null, true)
    loggerInstance.logLlmResponse('audit-a', 1, `before\n${'='.repeat(80)}\nafter\nSession ID: audit-b`)
    loggerInstance.logSessionStart('audit-b', 'Task B', 'auto', 'model', null, true)

    expect(loggerInstance.readSessionAuditLog('audit-a')).toContain('after\nSession ID: audit-b')
    expect(loggerInstance.readSessionAuditLog('audit-b')).not.toContain('before')
  })

  it('removes only the selected session across every retained generation', () => {
    const retained = new CodingAgentLogger({ logFilePath: logPath, maxSizeBytes: 1, maxRetainedFiles: 4 })
    retained.logSessionStart('audit-a', 'first', 'auto', 'model', null, true)
    retained.logSessionStart('audit-b', 'second', 'auto', 'model', null, true)
    retained.logPlanningStep('audit-a', 'ERROR', 'failure in older generation')
    retained.logPlanningStep('audit-b', 'ERROR', 'failure in newer generation')

    expect(retained.readSessionAuditLog('audit-a')).toContain('failure in older generation')
    expect(retained.removeSessionFromAuditLog('audit-a')).toBe(true)
    expect(retained.readSessionAuditLog('audit-a')).toBe('')
    expect(retained.readSessionAuditLog('audit-b')).toContain('failure in newer generation')
    expect(retained.readSessionAuditLog('audit-b')).toContain('second')
  })

  it('does not truncate the current audit file when rotation fails', () => {
    const retained = new CodingAgentLogger({ logFilePath: logPath, maxSizeBytes: 1, maxRetainedFiles: 2 })
    retained.logSessionStart('rotation-error', 'original task', 'auto', 'model', null, true)
    const rename = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('locked audit file')
    })
    try {
      retained.logPlanningStep('rotation-error', 'ERROR', 'planning failed')
    } finally {
      rename.mockRestore()
    }
    expect(retained.readSessionAuditLog('rotation-error')).toContain('original task')
    expect(retained.readSessionAuditLog('rotation-error')).toContain('planning failed')
  })
})
