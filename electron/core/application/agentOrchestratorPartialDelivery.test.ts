import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { recordMutationSideEffects } from './agentOrchestratorCircuitBreakerAndVerification'
import { GoalDecompositionPlanner } from '../../../shared/domain/agent/planAndSolveGraph'
import { TransactionalExecutionGuard } from '../infrastructure/filesystem/transactionalExecutionGuard'
import type { ToolResultProcessingContext } from './agentOrchestratorToolResultTypes'

/** live-full-task, 2026-08-24. */

let tempDir: string
let recordedDirectives: string[]

function makeContext(planner: GoalDecompositionPlanner): ToolResultProcessingContext {
  return {
    parsedTool: { tool: 'write_file', parameters: { filePath: 'postcss.config.js' } },
    toolRes: { outputForHistory: 'Successfully wrote file postcss.config.js', logMessage: 'wrote' },
    toolStartedAtMs: Date.now(),
    stepCount: 19,
    workspacePath: tempDir,
    flags: { hasFileMutations: false, hasVerifiedBuild: false },
    sessionChangedFiles: new Map(),
    goalPlanner: planner,
    executionGuard: new TransactionalExecutionGuard(tempDir),
    episodicCompactor: {
      recordStep: (_entry: unknown, directive?: string) => {
        if (directive) recordedDirectives.push(directive)
      },
    },
    persistCurrentState: async () => {},
    emitLog: () => {},
    settings: {},
  } as unknown as ToolResultProcessingContext
}

function plannerWith(milestones: Array<{ id: string; title: string; status: 'pending' | 'in_progress' }>) {
  const planner = new GoalDecompositionPlanner()
  planner.initializePlan(milestones as never)
  return planner
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-partial-delivery-'))
  recordedDirectives = []
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('partial delivery — the model is told which file it still owes', () => {
  const tailwindMilestone = [
    { id: 'm-6', title: 'Configure Tailwind CSS in `postcss.config.js` and `tailwind.config.js`', status: 'in_progress' as const },
  ]

  it('names the missing deliverable after the first half lands', async () => {
    fs.writeFileSync(path.join(tempDir, 'postcss.config.js'), 'module.exports = { plugins: { tailwindcss: {} } }\n')

    await recordMutationSideEffects(makeContext(plannerWith(tailwindMilestone)), 'postcss.config.js')

    const directive = recordedDirectives.find((d) => d.includes('STILL MISSING'))
    expect(directive).toBeDefined()
    expect(directive).toContain('"tailwind.config.js"')
    // Steers away from the delivered file without certifying it or threatening a block: that wording outlived its turn in the history block and contradicted a later live directive.
    expect(directive).toContain('rather than the file you have already delivered')
  })

  it('says nothing once every file the milestone names is on disk', async () => {
    fs.writeFileSync(path.join(tempDir, 'postcss.config.js'), 'module.exports = { plugins: { tailwindcss: {} } }\n')
    fs.writeFileSync(path.join(tempDir, 'tailwind.config.js'), 'module.exports = { content: ["./src/**/*.tsx"] }\n')

    await recordMutationSideEffects(makeContext(plannerWith(tailwindMilestone)), 'postcss.config.js')

    expect(recordedDirectives.filter((d) => d.includes('STILL MISSING'))).toEqual([])
  })

  // Credit the delivered file by advancing the milestone.
  it('does not undo the progress the write earned', async () => {
    fs.writeFileSync(path.join(tempDir, 'postcss.config.js'), 'module.exports = {}\n')
    const planner = plannerWith([{ ...tailwindMilestone[0], status: 'pending' }])

    await recordMutationSideEffects(makeContext(planner), 'postcss.config.js')

    expect(planner.findMilestone('m-6')?.status).toBe('in_progress')
  })

  it('stays silent for a milestone the write has nothing to do with', async () => {
    fs.writeFileSync(path.join(tempDir, 'postcss.config.js'), 'module.exports = {}\n')
    const planner = plannerWith([{ id: 'm-9', title: 'Create `src/components/Navbar.tsx`', status: 'in_progress' }])

    await recordMutationSideEffects(makeContext(planner), 'postcss.config.js')

    expect(recordedDirectives.filter((d) => d.includes('STILL MISSING'))).toEqual([])
  })

  // Do not call a just-written placeholder missing.
  it('does not report the file just written as missing when it holds a placeholder', async () => {
    fs.writeFileSync(path.join(tempDir, 'postcss.config.js'), '// TODO\n')
    fs.writeFileSync(path.join(tempDir, 'tailwind.config.js'), 'module.exports = { content: ["./src/**/*.tsx"] }\n')

    await recordMutationSideEffects(makeContext(plannerWith(tailwindMilestone)), 'postcss.config.js')

    expect(recordedDirectives.filter((d) => d.includes('STILL MISSING'))).toEqual([])
  })

  // Command evidence is absolute; deliverables are relative.
  it('matches an absolute evidence path against the relative deliverable', async () => {
    fs.writeFileSync(path.join(tempDir, 'postcss.config.js'), 'module.exports = {}\n')

    await recordMutationSideEffects(makeContext(plannerWith(tailwindMilestone)), path.join(tempDir, 'postcss.config.js'))

    const directive = recordedDirectives.find((d) => d.includes('STILL MISSING'))!
    expect(directive).toContain('"tailwind.config.js"')
    expect(directive).not.toContain('"postcss.config.js",')
  })
})
