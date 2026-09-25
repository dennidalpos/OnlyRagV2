import { describe, it, expect } from 'vitest'
import { AgentProgressPolicy } from '../domain/agent/agentProgressPolicy'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  applyVersionedReadEvidence,
  describeNonRollbackEffect,
  isToolExecutionFailure,
  runToolResultProcessing,
  shouldSpendExecutionRecoveryBudget,
  terminalOutcomeFor,
  updateVersionConflictRecovery,
} from './agentOrchestratorToolResultProcessor'
import type { ResponseInterpreterState, ToolResultProcessingContext } from './agentOrchestratorRunContext'
import { GoalDecompositionPlanner } from '../../../shared/domain/agent/planAndSolveGraph'
import { AgentActionLoopDetector } from '../domain/agent/loopDetector'
import { TransactionalExecutionGuard } from '../infrastructure/filesystem/transactionalExecutionGuard'
import { packagesWithFailedInstall } from '../domain/agent/installCommandParser'
import { resolvePlanDirective } from '../domain/agent/planDirectiveArbiter'
import { FileSystemRepository } from '../infrastructure/filesystem/fileSystemRepository'
import { contentVersion } from '../infrastructure/filesystem/fileContentVersion'

describe('structured tool outcomes', () => {
  it('passes a tool result localization key to the timeline without reading its English text', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-tool-log-'))
    const emitted: { message: string; key?: string }[] = []
    try {
      await runToolResultProcessing({
        parsedTool: { tool: 'inspect_os_env', parameters: {} },
        toolRes: {
          outcome: 'success',
          outputForHistory: 'Environment inspected',
          logMessage: 'Terminal Command Finished: npm test',
          localized: { message: { key: 'toolCommandFinished', params: { command: 'npm test' } } },
        },
        toolStartedAtMs: Date.now(),
        stepCount: 1,
        workspacePath: workspace,
        flags: { hasFileMutations: false, hasVerifiedBuild: false },
        sessionChangedFiles: new Map(),
        goalPlanner: new GoalDecompositionPlanner(),
        episodicCompactor: { recordStep: () => {} },
        executionGuard: new TransactionalExecutionGuard(workspace),
        loopDetector: new AgentActionLoopDetector(2),
        state: { guardEvents: [], progress: new AgentProgressPolicy(), versionEvidence: {} },
        sessionId: 'localized-tool-result',
        isSessionActive: () => false,
        rendererEvents: null,
        persistCurrentState: async () => {},
        emitLog: (_type: string, message: string, _detail?: string, meta?: { localized?: { message?: { key: string } } }) => {
          emitted.push({ message, key: meta?.localized?.message?.key })
        },
        emitDone: () => {},
        finalizeSession: () => {},
        closeApplicationRun: async () => ({ outcome: 'continue' }),
        settings: { enableCodingAgentDebugLog: false },
      } as unknown as ToolResultProcessingContext)
      expect(emitted).toContainEqual({ message: 'Terminal Command Finished: npm test', key: 'toolCommandFinished' })
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('does not infer failure from output text', () => {
    expect(isToolExecutionFailure({ outcome: 'success', outputForHistory: 'Error is discussed here.', logMessage: 'Read file' })).toBe(false)
    expect(isToolExecutionFailure({ outcome: 'rejected', outputForHistory: 'Looks fine.', logMessage: 'Policy rejected' })).toBe(true)
  })

  it('reports confirmed commands and uncertain failures as effects outside automatic rollback', () => {
    expect(
      describeNonRollbackEffect(
        { tool: 'run_command', parameters: { command: 'npm install demo' } },
        { outcome: 'success', outputForHistory: 'done', logMessage: 'done', effectOutcome: 'confirmed' },
      ),
    ).toBe('run_command: npm install demo')
    expect(
      describeNonRollbackEffect(
        { tool: 'run_command', parameters: { command: 'deploy' } },
        { outcome: 'failure', outputForHistory: 'timeout', logMessage: 'timeout', effectOutcome: 'uncertain' },
      ),
    ).toContain('effetto esterno incerto')
  })
})

describe('file version recovery', () => {
  it('uses the mandatory read instead of spending the generic execution retry', () => {
    expect(
      shouldSpendExecutionRecoveryBudget({
        outcome: 'rejected',
        outputForHistory: '[FILE VERSION CONFLICT: src/App.tsx]\nNo content was written.',
        logMessage: 'Conflict',
      }),
    ).toBe(false)
  })

  it('leaves a syntax rejection, which never reached the disk, to the edit-loop and no_mutation guards', () => {
    expect(
      shouldSpendExecutionRecoveryBudget({
        outcome: 'rejected',
        outputForHistory: "[PRE-COMMIT AST VALIDATION ERROR IN src/TaskCard.ts]\nAST Syntax Error: '>' expected. (Line 6:15)",
        logMessage: "Write File Rejected (AST Syntax Error): AST Syntax Error: '>' expected.",
      }),
    ).toBe(false)
    expect(
      shouldSpendExecutionRecoveryBudget({
        outcome: 'rejected',
        outputForHistory: 'Path escapes the workspace',
        logMessage: 'Rejected',
      }),
    ).toBe(true)
  })

  it('requires a read after conflict and clears it only after a successful read', () => {
    const state = { progress: new AgentProgressPolicy(), versionEvidence: { 'src/app.tsx': 'sha256:stale' } } as unknown as ResponseInterpreterState
    state.progress.onExecutionFailure('write_file:src/App.tsx:conflict')
    expect(
      updateVersionConflictRecovery({
        toolRes: { outcome: 'rejected', outputForHistory: '[FILE VERSION CONFLICT: src/App.tsx]\nNo content was written.', logMessage: 'Conflict' },
        parsedTool: { tool: 'write_file', parameters: { filePath: 'src/App.tsx' } },
        state,
      }),
    ).toEqual({ changed: true, conflictPath: 'src/App.tsx' })
    expect(state.pendingVersionConflictReadPath).toBe('src/App.tsx')
    expect(state.versionEvidence).toEqual({})

    updateVersionConflictRecovery({
      toolRes: {
        outcome: 'success',
        outputForHistory: '[FILE VERSION: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa]',
        logMessage: 'Read',
      },
      parsedTool: { tool: 'read_file', parameters: { filePath: 'src/Other.tsx' } },
      state,
    })
    expect(state.pendingVersionConflictReadPath).toBe('src/App.tsx')

    updateVersionConflictRecovery({
      toolRes: {
        outcome: 'success',
        outputForHistory: '[FILE VERSION: sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb]',
        logMessage: 'Read',
      },
      parsedTool: { tool: 'read_file', parameters: { filePath: 'src/App.tsx' } },
      state,
    })
    expect(state.pendingVersionConflictReadPath).toBeUndefined()
    expect(state.versionEvidence['src/app.tsx']).toBe('sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    expect(state.versionEvidence['src/other.tsx']).toBe('sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(state.progress.executionFailuresSpent).toBe(0)
  })

  it('does not require an impossible read before creating an absent file', () => {
    const state = { pendingVersionConflictReadPath: 'src/Old.tsx', versionEvidence: {} } as unknown as ResponseInterpreterState
    expect(
      updateVersionConflictRecovery({
        toolRes: {
          outcome: 'rejected',
          outputForHistory: '[FILE VERSION CONFLICT: tailwind.config.js]\nExpected: sha256:stale\nCurrent: missing\nNo content was written.',
          logMessage: 'Conflict',
        },
        parsedTool: { tool: 'write_file', parameters: { filePath: 'tailwind.config.js' } },
        state,
      }),
    ).toEqual({ changed: true })
    expect(state.pendingVersionConflictReadPath).toBeUndefined()
    expect(state.versionEvidence).toEqual({})
  })

  it('applies the last seen version to every later edit and still rejects an external modification', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-version-recovery-'))
    try {
      const filePath = path.join(tempDir, 'App.tsx')
      fs.writeFileSync(filePath, 'export const value = 1\n')
      const state = { versionEvidence: { 'app.tsx': contentVersion('export const value = 1\n') } }
      const edit = { tool: 'write_file' as const, parameters: { filePath: 'App.tsx', content: 'export const value = 2\n' } }

      const applied = applyVersionedReadEvidence(edit, state)
      expect(applied.toolCall.parameters.expectedContentHash).toBe(contentVersion('export const value = 1\n'))
      // Not consumed: a proposal the gate later refuses must not cost the model its read.
      expect(applyVersionedReadEvidence(edit, state).toolCall.parameters.expectedContentHash).toBe(contentVersion('export const value = 1\n'))
      // An explicit hash from the model wins, and an unseen file gets none.
      expect(
        applyVersionedReadEvidence({ ...edit, parameters: { ...edit.parameters, expectedContentHash: 'sha256:own' } }, state).toolCall.parameters
          .expectedContentHash,
      ).toBe('sha256:own')
      expect(applyVersionedReadEvidence({ ...edit, parameters: { ...edit.parameters, filePath: 'Other.tsx' } }, state).consumed).toBe(false)

      fs.writeFileSync(filePath, 'export const userValue = 3\n')
      const result = new FileSystemRepository().writeFileVersioned(
        filePath,
        String(applied.toolCall.parameters.content),
        String(applied.toolCall.parameters.expectedContentHash),
        () => undefined,
      )
      expect(result.success).toBe(false)
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('export const userValue = 3\n')
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('records the version its own successful edit left on disk, so the next edit of that file needs no read', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-own-edit-version-'))
    try {
      fs.mkdirSync(path.join(tempDir, 'src'))
      fs.writeFileSync(path.join(tempDir, 'src', 'App.jsx'), 'export default function App() { return null }\n')
      const state = { progress: new AgentProgressPolicy(), versionEvidence: {} } as unknown as ResponseInterpreterState

      expect(
        updateVersionConflictRecovery({
          toolRes: { outcome: 'success', outputForHistory: 'Successfully wrote file src/App.jsx (updated existing file)', logMessage: 'Updated' },
          parsedTool: { tool: 'write_file', parameters: { filePath: 'src/App.jsx' } },
          state,
          workspacePath: tempDir,
        }),
      ).toEqual({ changed: true })
      expect(state.versionEvidence['src/app.jsx']).toBe(contentVersion('export default function App() { return null }\n'))

      const next = applyVersionedReadEvidence({ tool: 'write_file', parameters: { filePath: 'src\\App.jsx', content: 'x' } }, state)
      expect(next.toolCall.parameters.expectedContentHash).toBe(contentVersion('export default function App() { return null }\n'))
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
      deliverableStatusOf: () => ({ satisfied: false, missing: [], resolved: [] }) as never,
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

describe('plan follows a successful move_file', () => {
  async function processMove(workspace: string, planner: GoalDecompositionPlanner, outcome: 'success' | 'failure') {
    let persisted = 0
    await runToolResultProcessing({
      parsedTool: { tool: 'move_file', parameters: { sourcePath: path.join(workspace, 'src', 'App.js'), targetPath: 'src/App.jsx' } },
      toolRes: { outcome, outputForHistory: outcome === 'success' ? 'Moved src/App.js to src/App.jsx' : 'ENOENT', logMessage: 'move' },
      toolStartedAtMs: Date.now(),
      stepCount: 8,
      workspacePath: workspace,
      flags: { hasFileMutations: false, hasVerifiedBuild: false },
      sessionChangedFiles: new Map(),
      goalPlanner: planner,
      episodicCompactor: { recordStep: () => {} },
      executionGuard: new TransactionalExecutionGuard(workspace),
      loopDetector: new AgentActionLoopDetector(2),
      state: { guardEvents: [], progress: new AgentProgressPolicy(), versionEvidence: {} },
      sessionId: 'session-move-remap',
      isSessionActive: () => false,
      rendererEvents: null,
      persistCurrentState: async () => {
        persisted += 1
      },
      emitLog: () => {},
      emitDone: () => {},
      finalizeSession: () => {},
      closeApplicationRun: async () => ({ outcome: 'continue' }),
      settings: { enableCodingAgentDebugLog: false },
    } as unknown as ToolResultProcessingContext)
    return persisted
  }

  it('remaps milestones to the renamed file and persists the plan', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-move-remap-'))
    try {
      fs.mkdirSync(path.join(workspace, 'src'))
      fs.writeFileSync(path.join(workspace, 'src', 'App.jsx'), 'export default () => <div/>')
      const planner = new GoalDecompositionPlanner()
      planner.initializePlan([{ id: 'm-6', title: 'Render the list', status: 'pending', filePaths: ['src/App.js'] }])

      expect(await processMove(workspace, planner, 'failure')).toBe(0)
      expect(planner.getMilestones()[0].filePaths).toEqual(['src/App.js'])

      expect(await processMove(workspace, planner, 'success')).toBeGreaterThan(0)
      expect(planner.getMilestones()[0].filePaths).toEqual(['src/App.jsx'])
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})

describe('plan follows a write under another script extension', () => {
  async function processWrite(workspace: string, planner: GoalDecompositionPlanner, filePath: string) {
    const logs: string[] = []
    await runToolResultProcessing({
      parsedTool: { tool: 'write_file', parameters: { filePath, content: 'export default function App() { return null }' } },
      toolRes: { outcome: 'success', outputForHistory: `Successfully wrote file ${filePath} (created new file)`, logMessage: 'Created new file' },
      toolStartedAtMs: Date.now(),
      stepCount: 6,
      workspacePath: workspace,
      flags: { hasFileMutations: false, hasVerifiedBuild: false },
      sessionChangedFiles: new Map(),
      goalPlanner: planner,
      episodicCompactor: { recordStep: () => {}, getEpisodes: () => [], getRecentFullLogs: () => [] },
      executionGuard: new TransactionalExecutionGuard(workspace),
      loopDetector: new AgentActionLoopDetector(2),
      state: { guardEvents: [], progress: new AgentProgressPolicy(), versionEvidence: {} },
      sessionId: 'session-alias-remap',
      isSessionActive: () => false,
      rendererEvents: null,
      persistCurrentState: async () => {},
      emitLog: (_type: string, message: string) => logs.push(message),
      emitDone: () => {},
      finalizeSession: () => {},
      closeApplicationRun: async () => ({ outcome: 'continue' }),
      settings: { enableCodingAgentDebugLog: false },
    } as unknown as ToolResultProcessingContext)
    return logs
  }

  it('points milestones naming a missing src/App.js at the src/App.jsx the agent wrote', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-alias-remap-'))
    try {
      fs.mkdirSync(path.join(workspace, 'src'))
      fs.writeFileSync(path.join(workspace, 'src', 'App.jsx'), 'export default function App() { return null }')
      const planner = new GoalDecompositionPlanner()
      planner.initializePlan([
        { id: 'm-6', title: 'Create a basic layout', status: 'pending', filePaths: ['src/App.js'] },
        { id: 'm-9', title: 'Implement navigation', status: 'pending', filePaths: ['src/App.js'] },
        { id: 'm-10', title: 'Smoke test', status: 'pending', filePaths: ['src/App.test.jsx'] },
      ])

      const logs = await processWrite(workspace, planner, 'src/App.jsx')

      expect(planner.getMilestones().map((m) => m.filePaths)).toEqual([['src/App.jsx'], ['src/App.jsx'], ['src/App.test.jsx']])
      expect(logs.some((line) => line.includes('m-6, m-9') && line.includes('src/App.jsx'))).toBe(true)
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('leaves the plan alone when the named file exists too', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-alias-keep-'))
    try {
      fs.mkdirSync(path.join(workspace, 'src'))
      fs.writeFileSync(path.join(workspace, 'src', 'App.js'), 'export default function App() { return null }')
      fs.writeFileSync(path.join(workspace, 'src', 'App.jsx'), 'export default function App() { return null }')
      const planner = new GoalDecompositionPlanner()
      planner.initializePlan([{ id: 'm-6', title: 'Create a basic layout', status: 'pending', filePaths: ['src/App.js'] }])

      await processWrite(workspace, planner, 'src/App.jsx')

      expect(planner.getMilestones()[0].filePaths).toEqual(['src/App.js'])
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})
