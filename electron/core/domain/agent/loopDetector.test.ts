import { describe, it, expect, beforeEach } from 'vitest'
import { AgentActionLoopDetector } from './loopDetector'
import type { AgentToolCall } from './agentTypes'

describe('AgentActionLoopDetector Unit Tests', () => {
  let detector: AgentActionLoopDetector

  beforeEach(() => {
    detector = new AgentActionLoopDetector(2)
  })

  it('should generate deterministic fingerprints for identical tool calls', () => {
    const call1: AgentToolCall = {
      tool: 'read_file',
      parameters: { filePath: 'src/index.ts', startLine: 1, endLine: 50 },
    }
    const call2: AgentToolCall = {
      tool: 'read_file',
      parameters: { filePath: 'src/index.ts', startLine: 1, endLine: 50 },
    }

    const fp1 = detector.generateFingerprint(call1)
    const fp2 = detector.generateFingerprint(call2)

    expect(fp1).toBe(fp2)
    expect(fp1).toHaveLength(64)
  })

  it('should generate distinct fingerprints for different tool calls', () => {
    const call1: AgentToolCall = {
      tool: 'read_file',
      parameters: { filePath: 'src/index.ts' },
    }
    const call2: AgentToolCall = {
      tool: 'write_file',
      parameters: { filePath: 'src/index.ts', content: 'test' },
    }

    const fp1 = detector.generateFingerprint(call1)
    const fp2 = detector.generateFingerprint(call2)

    expect(fp1).not.toBe(fp2)
  })

  it('should allow tool execution within tolerance without triggering loop alarm', () => {
    const call: AgentToolCall = {
      tool: 'run_command',
      parameters: { command: 'npm test' },
    }

    const res1 = detector.recordAndCheck(call)
    expect(res1.isLooping).toBe(false)
    expect(res1.consecutiveDuplicateCount).toBe(1)

    const res2 = detector.recordAndCheck(call)
    expect(res2.isLooping).toBe(false)
    expect(res2.consecutiveDuplicateCount).toBe(2)
  })

  it('should trigger loop intervention when duplicate threshold is exceeded', () => {
    const call: AgentToolCall = {
      tool: 'replace_file_content',
      parameters: { filePath: 'main.ts', targetContent: 'foo', replacementContent: 'bar' },
    }

    detector.recordAndCheck(call)
    detector.recordAndCheck(call)
    const res3 = detector.recordAndCheck(call)

    expect(res3.isLooping).toBe(true)
    expect(res3.consecutiveDuplicateCount).toBe(3)
    expect(res3.suggestedIntervention).toContain('[CRITICAL LOOP INTERVENTION')
  })

  it('should detect file edit thrashing when 2 distinct edits target the same file in a row, regardless of tool mix', () => {
    // A write_file followed by a distinct replace_file_content on the same file: the merged
    // check is tool-agnostic across the edit-class tools, so this must trip just as readily as
    // two of the same tool would.
    const call1: AgentToolCall = { tool: 'write_file', parameters: { filePath: 'src/config.ts', content: 'port = 3000' } }
    const call2: AgentToolCall = {
      tool: 'replace_file_content',
      parameters: { filePath: 'src/config.ts', targetContent: 'port = 3000', replacementContent: 'port = 8080' },
    }

    const res1 = detector.recordAndCheck(call1)
    expect(res1.isLooping).toBe(false)

    const res2 = detector.recordAndCheck(call2)
    expect(res2.isLooping).toBe(true)
    expect(res2.suggestedIntervention).toContain('[CRITICAL FILE EDIT LOOP: 2 EDITS ON src/config.ts WITHOUT VERIFICATION]')
    expect(res2.suggestedIntervention).toContain('DO NOT edit "src/config.ts" again in your next step.')
  })

  it('should detect redundant write_file loops when same target is written multiple times', () => {
    const call1: AgentToolCall = { tool: 'write_file', parameters: { filePath: 'src/App.tsx', content: 'content 1' } }
    const call2: AgentToolCall = { tool: 'write_file', parameters: { filePath: 'src/App.tsx', content: 'content 2' } }

    detector.recordAndCheck(call1)
    const res2 = detector.recordAndCheck(call2)

    expect(res2.isLooping).toBe(true)
    expect(res2.suggestedIntervention).toContain('[CRITICAL FILE EDIT LOOP: 2 EDITS ON src/App.tsx WITHOUT VERIFICATION]')
  })

  it('should detect redundant read loops when same target is read 3+ consecutive times', () => {
    const call1: AgentToolCall = {
      tool: 'read_file',
      parameters: { filePath: 'src/App.tsx', startLine: 1, endLine: 50 },
    }
    const call2: AgentToolCall = {
      tool: 'read_file',
      parameters: { filePath: 'src/App.tsx', startLine: 51, endLine: 100 },
    }
    const call3: AgentToolCall = {
      tool: 'read_file',
      parameters: { filePath: 'src/App.tsx', startLine: 1, endLine: 100 },
    }

    detector.recordAndCheck(call1)
    detector.recordAndCheck(call2)
    const res3 = detector.recordAndCheck(call3)

    expect(res3.isLooping).toBe(true)
    expect(res3.suggestedIntervention).toContain('[CRITICAL READ LOOP INTERVENTION: REPEATED READS ON src/App.tsx]')
  })

  it('should reset target history cleanly allowing fresh edit attempt after intervention', () => {
    const call1: AgentToolCall = { tool: 'replace_file_content', parameters: { filePath: 'src/App.tsx', targetContent: 'a', replacementContent: 'b' } }
    const call2: AgentToolCall = { tool: 'replace_file_content', parameters: { filePath: 'src/App.tsx', targetContent: 'c', replacementContent: 'd' } }
    const call3: AgentToolCall = { tool: 'replace_file_content', parameters: { filePath: 'src/App.tsx', targetContent: 'e', replacementContent: 'f' } }

    detector.recordAndCheck(call1)
    detector.recordAndCheck(call2)
    const res3 = detector.recordAndCheck(call3)
    expect(res3.isLooping).toBe(true)

    // Reset target after intervention
    detector.resetTarget('src/App.tsx')

    // Next corrective action (e.g. write_file) should not be blocked immediately
    const correctiveCall: AgentToolCall = { tool: 'write_file', parameters: { filePath: 'src/App.tsx', content: '// clean rewrite' } }
    const res4 = detector.recordAndCheck(correctiveCall)
    expect(res4.isLooping).toBe(false)
  })

  it('should reset history cleanly', () => {
    const call: AgentToolCall = {
      tool: 'list_dir',
      parameters: { dirPath: '.' },
    }

    detector.recordAndCheck(call)
    detector.recordAndCheck(call)
    expect(detector.historyLength).toBe(2)

    detector.reset()
    expect(detector.historyLength).toBe(0)
  })

  it('should detect the Shell-Tool Confusion Loop when a tool name is repeatedly passed to run_command', () => {
    const call: AgentToolCall = {
      tool: 'run_command',
      parameters: { command: 'write_file "src/App.tsx" "content"' },
    }

    const res1 = detector.recordAndCheck(call)
    expect(res1.isLooping).toBe(false)

    const res2 = detector.recordAndCheck(call)
    expect(res2.isLooping).toBe(true)
    expect(res2.suggestedIntervention).toContain('[CRITICAL SHELL-TOOL CONFUSION LOOP: "write_file" PASSED AS SHELL COMMAND')
    expect(res2.suggestedIntervention).toContain('"write_file" is a STRUCTURED TOOL')
  })

  it('should not trigger the Shell-Tool Confusion Loop for legitimate run_command calls', () => {
    const call: AgentToolCall = { tool: 'run_command', parameters: { command: 'npm run typecheck' } }

    const res1 = detector.recordAndCheck(call)
    expect(res1.isLooping).toBe(false)

    const res2 = detector.recordAndCheck(call)
    expect(res2.isLooping).toBe(false)
  })
})
