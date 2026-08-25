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
    expect(block).toContain('RECENT DETAILED TOOL OUTPUTS (2 most recent distinct actions)')
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

describe('workspace-state output expiry', () => {
  it('expires a compiler diagnostic after a successful file mutation changes the workspace', () => {
    const compactor = new EpisodicMemoryCompactor(6)
    compactor.recordStep(
      { step: 1, tool: 'run_command', target: 'npm run build', status: 'FAILURE', summary: 'build failed' },
      '[TERMINAL AUTO-HEALING DIAGNOSTICS LOG]\nTS2305: Module has no exported member Card'
    )

    expect(compactor.lastFailureOutputFor('run_command', 'npm run build')).toContain('TS2305')

    compactor.recordStep(
      { step: 2, tool: 'write_file', target: 'src/Card.tsx', status: 'SUCCESS', summary: 'wrote Card' },
      'Successfully wrote file src/Card.tsx'
    )

    const block = compactor.compilePromptHistoryBlock(50_000)
    expect(block).not.toContain('TS2305')
    expect(block).toContain('| Step 1 | `run_command` | npm run build | FAILURE | build failed |')
    expect(compactor.lastFailureOutputFor('run_command', 'npm run build')).toBeNull()
  })

  it('keeps only the newest detailed output for a file while retaining unrelated reads', () => {
    const compactor = new EpisodicMemoryCompactor(6)
    compactor.recordStep(
      { step: 1, tool: 'read_file', target: 'src/Keep.tsx', status: 'SUCCESS', summary: 'read' },
      'UNRELATED FILE CONTENT'
    )
    compactor.recordStep(
      { step: 2, tool: 'write_file', target: 'src/App.tsx', status: 'SUCCESS', summary: 'first write' },
      'Successfully wrote file src/App.tsx\n[UNDECLARED IMPORTS] stale-package'
    )
    compactor.recordStep(
      { step: 3, tool: 'write_file', target: 'src\\App.tsx', status: 'SUCCESS', summary: 'second write' },
      'Successfully wrote file src/App.tsx\nImports are now valid'
    )

    const detailed = compactor.compilePromptHistoryBlock(50_000).split('### RECENT DETAILED TOOL OUTPUTS')[1]
    expect(detailed).toContain('UNRELATED FILE CONTENT')
    expect(detailed).not.toContain('stale-package')
    expect(detailed).toContain('Imports are now valid')
  })
})

/**
 * The recent-outputs window is the model's view of what just happened, and it was a plain FIFO.
 *
 * Measured on live-full-task, 2026-08-24, step 48: of the 4.780 characters that section
 * contributed to the prompt, 3.988 — 83% — were four copies of `[CRITICAL FILE EDIT LOOP: N
 * EDITS ON src/pages/TasksPage.tsx]`, differing only in N. 792 characters were left for
 * anything the model had actually done; after this change the same step of a fresh run
 * carried 1.293.
 */
describe('EpisodicMemoryCompactor — the recent window does not fill with one repeated intervention', () => {
  const loopWarning = (n: number) =>
    `[CRITICAL FILE EDIT LOOP: ${n} EDITS ON src/pages/TasksPage.tsx WITHOUT VERIFICATION]\nDo not edit it again.`

  function blockedWrite(compactor: EpisodicMemoryCompactor, step: number, editCount: number) {
    compactor.recordStep(
      { step, tool: 'write_file', target: 'src/pages/TasksPage.tsx', status: 'BLOCKED', summary: 'loop' },
      loopWarning(editCount)
    )
  }

  it('keeps one slot for a repeated intervention on the same target, not one per attempt', () => {
    const compactor = new EpisodicMemoryCompactor(6)
    compactor.recordStep(
      { step: 42, tool: 'write_file', target: 'src/pages/TasksPage.tsx', status: 'SUCCESS', summary: 'wrote' },
      'Successfully wrote file src/pages/TasksPage.tsx'
    )
    compactor.recordStep(
      { step: 43, tool: 'read_file', target: 'src/App.tsx', status: 'SUCCESS', summary: 'read' },
      'export default function App() { return null }'
    )
    blockedWrite(compactor, 44, 4)
    blockedWrite(compactor, 45, 5)
    blockedWrite(compactor, 46, 6)
    blockedWrite(compactor, 47, 6)

    const block = compactor.compilePromptHistoryBlock(50_000)
    const warningCount = block.split('### RECENT DETAILED TOOL OUTPUTS')[1].split('CRITICAL FILE EDIT LOOP').length - 1
    expect(warningCount).toBe(1)
  })

  // The point of freeing those slots: the real work the model did stays visible.
  it('leaves the surrounding real work in the window', () => {
    const compactor = new EpisodicMemoryCompactor(6)
    compactor.recordStep(
      { step: 42, tool: 'write_file', target: 'src/pages/TasksPage.tsx', status: 'SUCCESS', summary: 'wrote' },
      'Successfully wrote file src/pages/TasksPage.tsx'
    )
    compactor.recordStep(
      { step: 43, tool: 'read_file', target: 'src/App.tsx', status: 'SUCCESS', summary: 'read' },
      'THE REAL CONTENT THE MODEL NEEDS'
    )
    for (let step = 44; step <= 49; step++) blockedWrite(compactor, step, step - 40)

    const detailed = compactor.compilePromptHistoryBlock(50_000).split('### RECENT DETAILED TOOL OUTPUTS')[1]
    expect(detailed).toContain('THE REAL CONTENT THE MODEL NEEDS')
    expect(detailed).toContain('Successfully wrote file src/pages/TasksPage.tsx')
  })

  // Only the newest attempt survives: it carries the current counter and the current advice.
  it('keeps the most recent copy of the intervention, not the first', () => {
    const compactor = new EpisodicMemoryCompactor(6)
    blockedWrite(compactor, 44, 4)
    blockedWrite(compactor, 47, 6)

    const detailed = compactor.compilePromptHistoryBlock(50_000).split('### RECENT DETAILED TOOL OUTPUTS')[1]
    expect(detailed).toContain('6 EDITS ON')
    expect(detailed).not.toContain('4 EDITS ON')
  })

  it('collapses an alternating A,B,A,B block pattern, not just consecutive repeats', () => {
    const compactor = new EpisodicMemoryCompactor(6)
    for (const step of [40, 42, 44]) {
      compactor.recordStep(
        { step, tool: 'read_file', target: 'src/App.tsx', status: 'BLOCKED', summary: 'loop' },
        `[READ LOOP] attempt ${step}`
      )
      compactor.recordStep(
        { step: step + 1, tool: 'read_file', target: 'src/pages/Dashboard.tsx', status: 'BLOCKED', summary: 'loop' },
        `[READ LOOP] attempt ${step + 1}`
      )
    }

    const detailed = compactor.compilePromptHistoryBlock(50_000).split('### RECENT DETAILED TOOL OUTPUTS')[1]
    expect(detailed.split('READ LOOP').length - 1).toBe(2)
  })

})
