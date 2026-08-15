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
})
