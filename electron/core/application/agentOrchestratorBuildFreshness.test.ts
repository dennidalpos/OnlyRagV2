import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { recordCommandTouchedFiles, trackVerification } from './agentOrchestratorCircuitBreakerAndVerification'
import { runToolResultProcessing } from './agentOrchestratorToolResultProcessor'
import { AgentActionLoopDetector } from '../domain/agent/loopDetector'
import { StagnationCircuitBreaker } from '../domain/agent/stagnationCircuitBreaker'
import { TransactionalExecutionGuard } from '../infrastructure/filesystem/transactionalExecutionGuard'
import type { ToolExecutionResult } from './agentToolExecutorService'
import type { ToolResultProcessingContext, ToolResultMutableFlags } from './agentOrchestratorToolResultTypes'

/**
 * `hasVerifiedBuild` was monotonic: any passing build kept vouching for files written long
 * afterwards, so the Definition of Done gate let a session finish on stale evidence. These
 * tests pin both halves of the replacement — a later write invalidates the build, and a build
 * that writes its own artefacts still ends the step verified.
 */

let tempDir: string

function makeContext(command: string, flags: ToolResultMutableFlags): ToolResultProcessingContext {
  return {
    parsedTool: { tool: 'run_command', parameters: { command } },
    toolRes: { outputForHistory: '' },
    toolStartedAtMs: Date.now() - 60_000,
    stepCount: 5,
    workspacePath: tempDir,
    flags,
    sessionChangedFiles: new Map(),
    goalPlanner: {
      getActiveMilestone: () => null,
      getMilestones: () => [],
      updateMilestone: () => true,
      getProgressSummary: () => ({ completed: 0, total: 0, percentage: 0 }),
    },
    episodicCompactor: { recordStep: () => {} },
    emitLog: () => {},
    settings: {},
  } as unknown as ToolResultProcessingContext
}

function freshFlags(): ToolResultMutableFlags {
  return { hasFileMutations: false, hasVerifiedBuild: true }
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-build-freshness-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('build freshness — a later write invalidates an earlier verification', () => {
  it('clears hasVerifiedBuild when a command writes files into the workspace', () => {
    fs.writeFileSync(path.join(tempDir, 'generated.js'), 'console.log(1)')
    const flags = freshFlags()

    recordCommandTouchedFiles(makeContext('node scaffold.js', flags), false)

    expect(flags.hasFileMutations).toBe(true)
    expect(flags.hasVerifiedBuild).toBe(false)
  })

  it('leaves an earlier verification standing when the command touched nothing', () => {
    const flags = freshFlags()

    recordCommandTouchedFiles(makeContext('echo hello', flags), false)

    expect(flags.hasFileMutations).toBe(false)
    expect(flags.hasVerifiedBuild).toBe(true)
  })

  it('ignores the debris of a failed command', () => {
    fs.writeFileSync(path.join(tempDir, 'half-written.js'), 'oops')
    const flags = freshFlags()

    recordCommandTouchedFiles(makeContext('npm create some-generator', flags), true)

    expect(flags.hasFileMutations).toBe(false)
    expect(flags.hasVerifiedBuild).toBe(true)
  })
})

describe('build freshness — a write that changed nothing is not a mutation', () => {
  /** Full tool-result context, since `isMutating` is decided inside runToolResultProcessing. */
  function makeWriteContext(toolRes: ToolExecutionResult, flags: ToolResultMutableFlags): ToolResultProcessingContext {
    return {
      parsedTool: { tool: 'write_file', parameters: { filePath: path.join(tempDir, 'App.tsx') } },
      toolRes,
      toolStartedAtMs: Date.now(),
      stepCount: 30,
      workspacePath: tempDir,
      flags,
      sessionChangedFiles: new Map(),
      goalPlanner: {
        getActiveMilestone: () => null,
        getMilestones: () => [],
        updateMilestone: () => true,
        getProgressSummary: () => ({ completed: 0, total: 0, percentage: 0 }),
      },
      episodicCompactor: { recordStep: () => {} },
      circuitBreaker: new StagnationCircuitBreaker(12, 5),
      executionGuard: new TransactionalExecutionGuard(tempDir),
      loopDetector: new AgentActionLoopDetector(2),
      recoveryState: {},
      sessionId: 'session-build-freshness',
      isSessionActive: () => false,
      targetWindow: null,
      persistCurrentState: async () => {},
      emitLog: () => {},
      emitDone: () => {},
      finalizeSession: () => {},
      settings: { enableCodingAgentDebugLog: false },
    } as unknown as ToolResultProcessingContext
  }

  // The churn loop this closes: green build -> identical rewrite -> the build is discarded as
  // stale -> the model runs it again. See redundantWriteDetector.ts.
  it('leaves the verification standing when write_file reported a no-op', async () => {
    const flags = freshFlags()

    await runToolResultProcessing(
      makeWriteContext({ outcome: 'success', outputForHistory: '[NO-OP WRITE: ...]', logMessage: 'No-op write', noOpMutation: true }, flags)
    )

    expect(flags.hasVerifiedBuild).toBe(true)
    expect(flags.hasFileMutations).toBe(false)
  })

  it('still invalidates the verification when write_file actually wrote something', async () => {
    const flags = freshFlags()

    await runToolResultProcessing(
      makeWriteContext({ outcome: 'success', outputForHistory: 'Successfully wrote file App.tsx', logMessage: 'Wrote App.tsx' }, flags)
    )

    expect(flags.hasVerifiedBuild).toBe(false)
    expect(flags.hasFileMutations).toBe(true)
  })
})

describe('build freshness — a verification command does not invalidate itself', () => {
  it('ends the step verified even though the build wrote its own output files', () => {
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ scripts: { build: 'vite build' } }))
    fs.mkdirSync(path.join(tempDir, 'dist'))
    fs.writeFileSync(path.join(tempDir, 'dist', 'bundle.js'), 'console.log(1)')

    // Starts unverified, exactly as a session does before its first build.
    const flags: ToolResultMutableFlags = {
      hasFileMutations: false,
      hasVerifiedBuild: false,
    }
    const ctx = makeContext('npm run build', flags)

    // Same order the tool result processor uses: touched files first, verification last.
    recordCommandTouchedFiles(ctx, false)
    expect(flags.hasVerifiedBuild).toBe(false)

    trackVerification(ctx, false)
    expect(flags.hasVerifiedBuild).toBe(true)
  })

  it('does not treat a successful dependency install containing "eslint" as verification', () => {
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint .' } }))
    const flags: ToolResultMutableFlags = { hasFileMutations: true, hasVerifiedBuild: false }
    const updates: string[] = []
    const ctx = makeContext('npm install eslint-config-prettier@10.1.8', flags)
    ctx.goalPlanner = {
      getActiveMilestone: () => null,
      getMilestones: () => [{ id: 'm-1', title: 'Create `package.json`', status: 'pending', filePaths: ['package.json'] }],
      updateMilestone: (id: string) => { updates.push(id); return true },
      getProgressSummary: () => ({ completed: 0, total: 1, percentage: 0 }),
    } as unknown as ToolResultProcessingContext['goalPlanner']

    trackVerification(ctx, false)

    expect(flags.hasVerifiedBuild).toBe(false)
    expect(updates).toEqual([])
  })

  it('does not promote a milestone or set the verification flag after a positive browser preview', () => {
    const flags: ToolResultMutableFlags = {
      hasFileMutations: true,
      hasVerifiedBuild: false,
    }
    const ctx = makeContext('open_in_browser', flags)
    ctx.parsedTool = { tool: 'open_in_browser', parameters: { filePath: 'dist/index.html' } }

    trackVerification(ctx, false)

    expect(flags.hasVerifiedBuild).toBe(false)
  })

  it('invalidates stale verification after a failed dependency install', () => {
    const flags = freshFlags()
    const ctx = makeContext('npm install @onlyrag/not-published-probe', flags)
    ctx.toolRes = { outcome: 'rejected', outputForHistory: '[PACKAGE DOES NOT EXIST — INSTALL NOT RUN]', logMessage: 'Install refused' }

    trackVerification(ctx, true)

    expect(flags.hasVerifiedBuild).toBe(false)
  })
})
