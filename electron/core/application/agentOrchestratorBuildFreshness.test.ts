import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { recordCommandTouchedFiles, trackVerification } from './agentOrchestratorCircuitBreakerAndVerification'
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
  return { hasFileMutations: false, hasVerifiedBuild: true, currentOverriddenModel: null }
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

describe('build freshness — a verification command does not invalidate itself', () => {
  it('ends the step verified even though the build wrote its own output files', () => {
    fs.mkdirSync(path.join(tempDir, 'dist'))
    fs.writeFileSync(path.join(tempDir, 'dist', 'bundle.js'), 'console.log(1)')

    // Starts unverified, exactly as a session does before its first build.
    const flags: ToolResultMutableFlags = {
      hasFileMutations: false,
      hasVerifiedBuild: false,
      currentOverriddenModel: null,
    }
    const ctx = makeContext('npm run build', flags)

    // Same order the tool result processor uses: touched files first, verification last.
    recordCommandTouchedFiles(ctx, false)
    expect(flags.hasVerifiedBuild).toBe(false)

    trackVerification(ctx, false)
    expect(flags.hasVerifiedBuild).toBe(true)
  })
})
