import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyVersionedReadEvidence, isToolExecutionFailure, shouldSpendExecutionRecoveryBudget, terminalOutcomeFor, updateVersionConflictRecovery } from './agentOrchestratorToolResultProcessor'
import { packagesWithFailedInstall } from '../domain/agent/installCommandParser'
import { resolvePlanDirective } from '../domain/agent/planDirectiveArbiter'
import { FileSystemRepository } from '../infrastructure/filesystem/fileSystemRepository'
import { contentVersion } from '../infrastructure/filesystem/fileContentVersion'

describe('structured tool outcomes', () => {
  it('does not infer failure from output text', () => {
    expect(isToolExecutionFailure({ outcome: 'success', outputForHistory: 'Error is discussed here.', logMessage: 'Read file' })).toBe(false)
    expect(isToolExecutionFailure({ outcome: 'rejected', outputForHistory: 'Looks fine.', logMessage: 'Policy rejected' })).toBe(true)
  })
})

describe('file version recovery', () => {
  it('uses the mandatory read instead of spending the generic execution retry', () => {
    expect(shouldSpendExecutionRecoveryBudget({
      outcome: 'rejected',
      outputForHistory: '[FILE VERSION CONFLICT: src/App.tsx]\nNo content was written.',
      logMessage: 'Conflict',
    })).toBe(false)
  })

  it('requires a read after conflict and clears it only after a successful read', () => {
    const recoveryState: any = {}
    expect(updateVersionConflictRecovery({
      toolRes: { outcome: 'rejected', outputForHistory: '[FILE VERSION CONFLICT: src/App.tsx]\nNo content was written.', logMessage: 'Conflict' },
      parsedTool: { tool: 'write_file', parameters: { filePath: 'src/App.tsx' } },
      recoveryState,
    })).toEqual({ changed: true, conflictPath: 'src/App.tsx' })
    expect(recoveryState.pendingVersionConflictReadPath).toBe('src/App.tsx')

    updateVersionConflictRecovery({
      toolRes: { outcome: 'success', outputForHistory: '[FILE VERSION: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa]', logMessage: 'Read' },
      parsedTool: { tool: 'read_file', parameters: { filePath: 'src/Other.tsx' } },
      recoveryState,
    })
    expect(recoveryState.pendingVersionConflictReadPath).toBe('src/App.tsx')

    updateVersionConflictRecovery({
      toolRes: { outcome: 'success', outputForHistory: '[FILE VERSION: sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb]', logMessage: 'Read' },
      parsedTool: { tool: 'read_file', parameters: { filePath: 'src/App.tsx' } },
      recoveryState,
    })
    expect(recoveryState.pendingVersionConflictReadPath).toBeUndefined()
    expect(recoveryState.versionedReadEvidence.filePath).toBe('src/App.tsx')
  })

  it('applies read evidence once and still rejects an external modification', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-version-recovery-'))
    try {
      const filePath = path.join(tempDir, 'App.tsx')
      fs.writeFileSync(filePath, 'export const value = 1\n')
      const state = {
        versionedReadEvidence: {
          filePath: 'App.tsx',
          contentHash: contentVersion('export const value = 1\n'),
        },
      }
      const applied = applyVersionedReadEvidence({
        tool: 'write_file',
        parameters: { filePath: 'App.tsx', content: 'export const value = 2\n' },
      }, state)

      expect(applied.toolCall.parameters.expectedContentHash).toBe(contentVersion('export const value = 1\n'))
      expect(state.versionedReadEvidence).toBeUndefined()

      fs.writeFileSync(filePath, 'export const userValue = 3\n')
      const result = new FileSystemRepository().writeFileVersioned(
        filePath,
        String(applied.toolCall.parameters.content),
        String(applied.toolCall.parameters.expectedContentHash),
        () => undefined
      )
      expect(result.success).toBe(false)
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('export const userValue = 3\n')
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

describe('MODEL_UNSUITABLE terminal outcome', () => {
  it('returns from processing instead of continuing the agent loop', () => {
    const outcome = terminalOutcomeFor({
      outcome: 'blocked',
      outputForHistory: 'The requested model capability is unavailable.',
      logMessage: 'Model capability unavailable',
      isTerminal: true,
      terminalCode: 'MODEL_UNSUITABLE',
    })

    expect(outcome).toEqual({
      outcome: 'return',
      result: { success: false, summary: 'The requested model capability is unavailable.', completionStatus: 'blocked' },
    })
    expect(outcome?.outcome).not.toBe('continue')
  })
})

describe('refused installs reach the plan directive arbiter', () => {
  const REFUSAL =
    '[PACKAGE DOES NOT EXIST — INSTALL NOT RUN]\n' +
    'The npm registry has no package named "@tailwindcss/react". This command was not executed, ' +
    'because no flag makes an install of a non-existent package succeed.\n' +
    'Directives:\n1. Do NOT run this install again, and do NOT add --force or --legacy-peer-deps.'

  it('reports a registry-refused install as a failure', () => {
    expect({ outcome: 'rejected', output: REFUSAL }.outcome).toBe('rejected')
  })

  it('reports a preflight downgrade refusal as a failure', () => {
    expect({ outcome: 'rejected' as const }.outcome).toBe('rejected')
  })

  it('counts refusals toward the uninstallable threshold instead of resetting it', () => {
    const episodes = [
      { tool: 'run_command', target: 'npm install @tailwindcss/react', status: 'FAILURE' as const },
      { tool: 'run_command', target: 'npm install @tailwindcss/react', status: 'FAILURE' as const },
    ]
    expect(packagesWithFailedInstall(episodes)).toContain('@tailwindcss/react')
  })

  it('was defeated by the old SUCCESS label, which reset the count', () => {
    const episodes = [
      { tool: 'run_command', target: 'npm install @tailwindcss/react', status: 'FAILURE' as const },
      { tool: 'run_command', target: 'npm install @tailwindcss/react', status: 'SUCCESS' as const },
      { tool: 'run_command', target: 'npm install @tailwindcss/react', status: 'FAILURE' as const },
    ]
    expect(packagesWithFailedInstall(episodes)).not.toContain('@tailwindcss/react')
  })

  it('stops ordering the install and orders the import rewrite once the package is known bad', () => {
    const undeclared = [{ packageName: '@tailwindcss/react', importedBy: ['src/pages/DashboardPage.tsx'] }]
    const base = {
      hasVerifiedBuild: false,
      milestones: [],
      activeMilestone: undefined,
      deliverableStatusOf: () => ({ satisfied: false, missing: [], resolved: [] }) as any,
      missingDependencies: [],
      undeclaredDependencies: undeclared,
      verificationCommand: null,
      verificationFailing: false,
      disconnectedEntrypoint: null,
    }

    expect(resolvePlanDirective({ ...base, packagesWithFailedInstall: [] }).kind).toBe('dependencies_undeclared')

    const escalated = resolvePlanDirective({ ...base, packagesWithFailedInstall: ['@tailwindcss/react'] })
    expect(escalated.kind).toBe('dependencies_uninstallable')
    expect(escalated.blockDirective).toContain('@tailwindcss/react')
  })
})
