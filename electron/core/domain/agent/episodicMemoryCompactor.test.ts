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

  it('should cap stored episodes to 100 max and deduplicate identical failure logs', () => {
    // Record 110 steps
    for (let i = 1; i <= 110; i++) {
      compactor.recordStep(
        {
          step: i,
          tool: 'write_file',
          target: 'App.tsx',
          status: 'BLOCKED',
          summary: 'Intervention issued',
        },
        'Identical intervention output'
      )
    }

    expect(compactor.episodeCount).toBe(100)
    // Failure logs should be deduplicated (1 entry instead of 8 identical entries)
    const state = compactor.toState()
    expect(state.recentFullLogs.length).toBeLessThanOrEqual(3)
  })
})

describe('failure-block accumulation', () => {
  it('collapses alternating failures on two targets instead of stacking them', () => {
    const compactor = new EpisodicMemoryCompactor()

    // What a blocked model actually does: A, B, A, B... Comparing only the buffer's tail
    // matched none of these, and eight near-identical intervention blocks filled the prompt
    // (session-1787562597025-q8a5, steps 25-36).
    for (let step = 1; step <= 8; step++) {
      const target = step % 2 === 0 ? 'src/App.tsx' : 'src/pages/Dashboard.tsx'
      compactor.recordStep(
        { step, tool: 'read_file', target, status: 'BLOCKED', summary: 'redundant repeat' },
        `[REDUNDANT ACTION] Attempt ${step} on ${target}`
      )
    }

    const block = compactor.compilePromptHistoryBlock()
    const failureBlockCount = (block.match(/#### \[FAILURE at Step/g) || []).length
    expect(failureBlockCount).toBe(2)
    // Only the most recent attempt per target survives.
    expect(block).toContain('Attempt 8 on src/App.tsx')
    expect(block).toContain('Attempt 7 on src/pages/Dashboard.tsx')
    expect(block).not.toContain('Attempt 1 on')
  })

  it('keeps distinct failures on distinct targets', () => {
    const compactor = new EpisodicMemoryCompactor()
    for (const target of ['a.ts', 'b.ts', 'c.ts']) {
      compactor.recordStep(
        { step: 1, tool: 'write_file', target, status: 'FAILURE', summary: 'x' },
        `failed on ${target}`
      )
    }

    const block = compactor.compilePromptHistoryBlock()
    expect((block.match(/#### \[FAILURE at Step/g) || []).length).toBe(3)
  })
})
