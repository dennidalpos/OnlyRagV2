import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('../../diagnostics', () => ({
  logger: { log: vi.fn() },
  getCachedGpuInfo: () => ({ hasNvidiaGpu: false }),
  getMemoryInfo: () => ({ totalRAMGB: 16 }),
}))

import { buildCurrentOperationContext, readTurnFileContext, resolveTurnFileTargets } from './agentOrchestratorPromptAssembly'
import type { TurnDispatchContext } from './agentOrchestratorTurnDispatchTypes'
import type { PlanDirectiveDecision } from '../domain/agent/planDirectiveArbiter'

/**
 * The measurement behind this file: across four independent full-task runs in
 * logs/coding_agent_audit.log the model issued 74 `write_file` calls and called `read_file`
 * exactly zero times — and `replace_file_content` zero times as well. The coding prompt already
 * instructs it to read before acting (rule 7). Telling it again is the move blueprint §6.2.1
 * rules out; supplying the file is the move it prescribes.
 */

let tempDir: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-turnfiles-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

function ctxWith(activeTitle?: string): TurnDispatchContext {
  return {
    workspacePath: tempDir,
    goalPlanner: { getActiveMilestone: () => (activeTitle ? { title: activeTitle } : undefined) },
  } as unknown as TurnDispatchContext
}

const focus: PlanDirectiveDecision = { kind: 'focus', blockDirective: null, closureStepDirective: null }

describe('readTurnFileContext', () => {
  it('hands over the content of a file that exists', () => {
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'src', 'App.tsx'), 'export const App = () => <div>real content</div>\n')

    const block = readTurnFileContext(ctxWith(), ['src/App.tsx'], 'because')
    expect(block).toContain('real content')
    expect(block).toContain('src/App.tsx')
    expect(block).toContain('because')
    // The instruction rides with the data: a wholesale replace is what produced 208-byte stubs.
    expect(block).toContain('DO NOT REPLACE IT WITH A SHORTER FILE')
  })

  it('is silent when the file does not exist yet', () => {
    expect(readTurnFileContext(ctxWith(), ['src/NotThere.tsx'], 'because')).toBe('')
  })

  it('is silent for an empty file, which has nothing to preserve', () => {
    fs.writeFileSync(path.join(tempDir, 'empty.ts'), '   \n')
    expect(readTurnFileContext(ctxWith(), ['empty.ts'], 'because')).toBe('')
  })

  it('refuses to read outside the workspace', () => {
    // The paths come from scanners and from plan titles the model wrote, so neither is trusted.
    expect(readTurnFileContext(ctxWith(), ['../../../etc/passwd'], 'because')).toBe('')
  })

  it('is silent with no targets and with no workspace', () => {
    expect(readTurnFileContext(ctxWith(), [], 'because')).toBe('')
    expect(readTurnFileContext(ctxWith(), undefined, 'because')).toBe('')
    expect(readTurnFileContext({} as TurnDispatchContext, ['a.ts'], 'because')).toBe('')
  })

  it('includes one primary file, two support fragments and visible omission markers', () => {
    for (const [name, size] of [['primary.ts', 13000], ['support-a.ts', 4000], ['support-b.ts', 20], ['ignored.ts', 20]] as const) {
      fs.writeFileSync(path.join(tempDir, name), name.repeat(Math.ceil(size / name.length)).slice(0, size))
    }

    const block = readTurnFileContext(ctxWith(), ['primary.ts', 'support-a.ts', 'support-b.ts', 'ignored.ts'], 'test')
    expect(block).toContain('PRIMARY EDIT FILE: primary.ts')
    expect(block).toContain('SUPPORT FRAGMENT: support-a.ts')
    expect(block).toContain('SUPPORT FRAGMENT: support-b.ts')
    expect(block).not.toContain('ignored.ts')
    expect(block).toContain('CONTENT OMITTED:')
  })
})

describe('buildCurrentOperationContext', () => {
  it('keeps objective, constraints, relevant paths and only the latest useful error together', () => {
    const ctx = {
      userTask: 'Fix the app',
      workspacePath: tempDir,
      fsmMode: { getMode: () => 'AGENT' },
      goalPlanner: { getActiveMilestone: () => ({ title: 'Fix src/app.ts', notes: 'Keep the public API' }) },
      episodicCompactor: {
        getRecentFullLogs: () => [
          { step: 1, tool: 'run_command', target: 'npm test', output: 'old error', isFailure: true },
          { step: 2, tool: 'run_command', target: 'npm test', output: 'latest error', isFailure: true },
        ],
      },
    } as unknown as TurnDispatchContext
    const block = buildCurrentOperationContext(
      ctx,
      focus,
      { allowedTools: ['write_file'], rationale: 'test' },
      ['src/app.ts'],
    )

    expect(block).toContain('Objective: Fix src/app.ts')
    expect(block).toContain('accepted decision=Keep the public API')
    expect(block).toContain('Relevant paths: src/app.ts')
    expect(block).toContain('latest error')
    expect(block).not.toContain('old error')
  })
})

describe('resolveTurnFileTargets', () => {
  it('prefers the files the directive explicitly orders rewritten', () => {
    const directive: PlanDirectiveDecision = {
      kind: 'dependencies_uninstallable',
      blockDirective: 'x',
      closureStepDirective: null,
      rewriteTargets: ['src/pages/DashboardPage.tsx'],
    }
    const resolved = resolveTurnFileTargets(ctxWith('m-1: something — src/other.tsx'), directive)
    expect(resolved.targets).toEqual(['src/pages/DashboardPage.tsx'])
    expect(resolved.reason).toContain('orders you to rewrite')
  })

  it('falls back to the active milestone deliverables on an ordinary progress turn', () => {
    const resolved = resolveTurnFileTargets(ctxWith('m-4: Dashboard page — src/pages/DashboardPage.tsx'), focus)
    expect(resolved.targets).toContain('src/pages/DashboardPage.tsx')
  })

  it('yields nothing on a command turn, where no file is being written', () => {
    const install: PlanDirectiveDecision = { kind: 'dependencies_missing', blockDirective: 'x', closureStepDirective: null }
    expect(resolveTurnFileTargets(ctxWith('m-4: Dashboard — src/pages/DashboardPage.tsx'), install).targets).toEqual([])
  })

  it('yields nothing when there is no active milestone', () => {
    expect(resolveTurnFileTargets(ctxWith(), focus).targets).toEqual([])
  })
})
