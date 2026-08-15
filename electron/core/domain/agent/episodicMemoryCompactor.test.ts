import { describe, it, expect, beforeEach } from 'vitest'
import { EpisodicMemoryCompactor } from './episodicMemoryCompactor'

describe('EpisodicMemoryCompactor Domain Unit Tests', () => {
  let compactor: EpisodicMemoryCompactor

  beforeEach(() => {
    compactor = new EpisodicMemoryCompactor(3)
  })

  it('should return empty string when no steps recorded', () => {
    expect(compactor.compilePromptHistoryBlock()).toBe('')
    expect(compactor.episodeCount).toBe(0)
    expect(compactor.failureCount).toBe(0)
  })

  it('should format trajectory table and recent detailed logs correctly', () => {
    compactor.recordStep(
      {
        step: 1,
        tool: 'read_file',
        target: 'src/index.ts',
        status: 'SUCCESS',
        summary: 'Inspected file contents',
      },
      'const a = 10\nconsole.log(a)'
    )

    compactor.recordStep(
      {
        step: 2,
        tool: 'replace_file_content',
        target: 'src/index.ts',
        status: 'FAILURE',
        summary: 'Target string mismatch',
      },
      '[REPLACE FILE ERROR IN src/index.ts]\nTarget content not found'
    )

    expect(compactor.episodeCount).toBe(2)
    expect(compactor.failureCount).toBe(1)

    const block = compactor.compilePromptHistoryBlock(5000)
    expect(block).toContain('COMPLETE EXECUTION TRAJECTORY')
    expect(block).toContain('| Step 1 | `read_file` | src/index.ts | SUCCESS | Inspected file contents |')
    expect(block).toContain('| Step 2 | `replace_file_content` | src/index.ts | FAILURE | Target string mismatch |')
    expect(block).toContain('RECENT DETAILED TOOL OUTPUTS (Last 2 Steps)')
    expect(block).toContain('Target content not found')
  })

  it('should keep trajectory table intact while retaining only maxRecentDetailedSteps in full logs', () => {
    for (let i = 1; i <= 6; i++) {
      compactor.recordStep(
        {
          step: i,
          tool: `tool_${i}`,
          target: `file_${i}.ts`,
          status: i % 2 === 0 ? 'FAILURE' : 'SUCCESS',
          summary: `Summary of step ${i}`,
        },
        `Detailed log for step ${i}`
      )
    }

    expect(compactor.episodeCount).toBe(6)
    expect(compactor.failureCount).toBe(3)

    const block = compactor.compilePromptHistoryBlock(8000)
    // All 6 steps must appear in the trajectory table
    for (let i = 1; i <= 6; i++) {
      expect(block).toContain(`| Step ${i} | \`tool_${i}\` |`)
    }

    // Only the last 3 detailed logs must appear
    expect(block).toContain('Step 6 - Tool: tool_6')
    expect(block).toContain('Step 5 - Tool: tool_5')
    expect(block).toContain('Step 4 - Tool: tool_4')
    expect(block).not.toContain('Step 1 - Tool: tool_1')
  })
})
