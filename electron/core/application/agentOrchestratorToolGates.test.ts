import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { recordToolPolicyDenial, runToolGates } from './agentOrchestratorToolGates'
import { agentToolExecutorService } from './agentToolExecutorService'
import { AgentProgressPolicy, PROGRESS_BUDGET } from '../domain/agent/agentProgressPolicy'
import type { AgentGuardEvent } from '../../../shared/types'

// Host-native paths: the resolver uses node:path, so a literal C:\ is only absolute on Windows.
const hostRoot = path.parse(process.cwd()).root

describe('runToolGates network-approved policy', () => {
  it('rejects a tool omitted from the current phase before approval or execution', async () => {
    const requestApproval = vi.fn()
    const recordStep = vi.fn()
    const result = await runToolGates({
      parsedTool: { tool: 'run_command', parameters: { command: 'npm test' } },
      agentMode: 'auto',
      fsmMode: { isToolAllowed: vi.fn(() => true) } as never,
      workspacePath: null,
      stepCount: 2,
      episodicCompactor: { recordStep } as never,
      capabilityPolicyMode: 'network-approved',
      emitLog: vi.fn(),
      requestApproval,
      allowedToolsForTurn: ['read_file'],
    })

    expect(result).toMatchObject({ outcome: 'denied', policyDenial: 'turn_policy', feedback: expect.stringContaining('[TURN TOOL POLICY DENIED]') })
    expect(requestApproval).not.toHaveBeenCalled()
    expect(recordStep).toHaveBeenCalledOnce()
  })

  it('turns an explicit network approval into a one-use policy consent', async () => {
    const requestApproval = vi.fn().mockResolvedValue({ approved: true })

    const result = await runToolGates({
      parsedTool: { tool: 'web_search', parameters: { query: 'official documentation' } },
      agentMode: 'auto',
      fsmMode: {
        isToolAllowed: vi.fn(() => false),
        filterAllowedTools: vi.fn(() => []),
        getMode: vi.fn(() => 'ASK'),
      } as never,
      workspacePath: null,
      stepCount: 4,
      episodicCompactor: { recordStep: vi.fn() } as never,
      emitLog: vi.fn(),
      requestApproval,
      capabilityPolicyMode: 'network-approved',
    })

    expect(requestApproval).toHaveBeenCalledOnce()
    // A search is not a file write: the card must not try to diff the query as a path.
    expect(requestApproval.mock.calls[0][0]).toMatchObject({ type: 'network_request', target: 'official documentation' })
    expect(result).toMatchObject({
      outcome: 'allowed',
      policyConsent: { requested: true, granted: true },
    })
    if (result.outcome === 'allowed') expect(result.policyConsent?.consentId).toMatch(/^consent-/)
  })

  it('keeps Ask read-only even when a mutation also requests network consent', async () => {
    const requestApproval = vi.fn().mockResolvedValue({ approved: true })
    const result = await runToolGates({
      parsedTool: { tool: 'download_file', parameters: { url: 'https://example.test/data.txt', filePath: 'data.txt' } },
      agentMode: 'ask',
      fsmMode: {
        isToolAllowed: vi.fn(() => false),
        filterAllowedTools: vi.fn(() => []),
        getMode: vi.fn(() => 'ASK'),
      } as never,
      workspacePath: 'C:\\workspace',
      stepCount: 5,
      episodicCompactor: { recordStep: vi.fn() } as never,
      emitLog: vi.fn(),
      requestApproval,
      capabilityPolicyMode: 'network-approved',
    })

    expect(requestApproval).not.toHaveBeenCalled()
    expect(result).toEqual({ outcome: 'denied', feedback: expect.stringContaining('[FSM PERMISSION DENIED]') })
  })

  it('combines Guided mutation and network consent into one review', async () => {
    const requestApproval = vi.fn().mockResolvedValue({ approved: true })
    const result = await runToolGates({
      parsedTool: { tool: 'download_file', parameters: { url: 'https://example.test/data.txt', filePath: 'data.txt' } },
      agentMode: 'guided',
      fsmMode: { isToolAllowed: vi.fn(() => true) } as never,
      workspacePath: 'C:\\workspace',
      stepCount: 5,
      episodicCompactor: { recordStep: vi.fn() } as never,
      emitLog: vi.fn(),
      requestApproval,
      capabilityPolicyMode: 'network-approved',
    })

    expect(requestApproval).toHaveBeenCalledOnce()
    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({ reasons: ['network_access', 'guided_review'] }))
    expect(result).toMatchObject({ outcome: 'allowed', policyConsent: { requested: true, granted: true } })
  })
})

describe('runToolGates structured command safety', () => {
  const base = {
    agentMode: 'auto' as const,
    fsmMode: { isToolAllowed: vi.fn(() => true) } as never,
    workspacePath: path.join(hostRoot, 'workspace'),
    stepCount: 6,
    episodicCompactor: { recordStep: vi.fn() } as never,
    capabilityPolicyMode: 'network-approved' as const,
    emitLog: vi.fn(),
  }

  it('asks once before executing a confined command mutation', async () => {
    const requestApproval = vi.fn().mockResolvedValue({ approved: true })
    const result = await runToolGates({
      ...base,
      requestApproval,
      parsedTool: { tool: 'run_command', parameters: { command: 'Set-Content -Path src\\state.txt -Value ready' } },
    })

    expect(requestApproval).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ outcome: 'allowed', commandApprovalGranted: true })
  })

  it('rejects an out-of-workspace command before approval', async () => {
    const requestApproval = vi.fn()
    const result = await runToolGates({
      ...base,
      requestApproval,
      parsedTool: { tool: 'run_command', parameters: { command: `Remove-Item -Recurse -Force ${hostRoot}` } },
    })

    expect(result).toEqual({ outcome: 'denied', feedback: expect.stringContaining('[COMMAND SAFETY DENIED]') })
    expect(requestApproval).not.toHaveBeenCalled()
  })
})

describe('runToolGates full access', () => {
  const base = {
    fsmMode: { isToolAllowed: vi.fn(() => true), filterAllowedTools: vi.fn(() => []), getMode: vi.fn(() => 'ASK') } as never,
    workspacePath: path.join(hostRoot, 'workspace'),
    stepCount: 1,
    episodicCompactor: { recordStep: vi.fn() } as never,
    capabilityPolicyMode: 'offline-strict' as const,
    fullAccess: true,
    emitLog: vi.fn(),
    requestApproval: vi.fn(),
    allowedToolsForTurn: ['read_file'] as const,
  }

  it('allows Guided commands and installations without application approval', async () => {
    for (const parsedTool of [
      { tool: 'run_command' as const, parameters: { command: `Remove-Item -Recurse -Force ${hostRoot}` } },
      { tool: 'ensure_tool' as const, parameters: { toolName: 'git' } },
    ]) {
      const result = await runToolGates({ ...base, agentMode: 'guided', parsedTool })
      expect(result).toMatchObject({ outcome: 'allowed', toolCallForExecution: parsedTool })
    }
    expect(base.requestApproval).not.toHaveBeenCalled()
  })

  it('keeps Ask read-only with full access selected', async () => {
    const result = await runToolGates({ ...base, agentMode: 'ask', parsedTool: { tool: 'write_file', parameters: { filePath: 'x', content: 'x' } } })
    expect(result.outcome).toBe('denied')
    expect(base.requestApproval).not.toHaveBeenCalled()
  })

  it('blocks recursive cleanup after failed lint while preserving other Full access commands', async () => {
    const episodes = [{ tool: 'run_command', target: 'npm run lint', status: 'FAILURE' }]
    const recordStep = vi.fn()
    const context = { ...base, agentMode: 'auto' as const, episodicCompactor: { getEpisodes: () => episodes, recordStep } as never }
    for (const command of ['Remove-Item -Recurse -Force dist', 'rm -rf node_modules']) {
      const result = await runToolGates({ ...context, parsedTool: { tool: 'run_command', parameters: { command } } })
      expect(result).toMatchObject({ outcome: 'denied', feedback: expect.stringContaining('[LINT RECOVERY BLOCKED]') })
    }
    expect(recordStep).toHaveBeenCalledTimes(2)
    expect(await runToolGates({ ...context, parsedTool: { tool: 'run_command', parameters: { command: 'npm run typecheck' } } })).toMatchObject({
      outcome: 'allowed',
    })
    episodes[0].target = 'npx eslint .'
    expect(await runToolGates({ ...context, parsedTool: { tool: 'run_command', parameters: { command: 'rmdir /s /q dist' } } })).toMatchObject({
      outcome: 'denied',
    })
  })

  it('prepares a commit without requesting approval', async () => {
    const preview = vi.spyOn(agentToolExecutorService, 'previewGitCommit').mockReturnValue({ paths: ['a.txt'], diffText: 'diff', diffHash: 'hash' } as never)
    try {
      const result = await runToolGates({ ...base, agentMode: 'auto', parsedTool: { tool: 'git_commit', parameters: { commitMessage: 'test' } } })
      expect(result).toMatchObject({ outcome: 'allowed', toolCallForExecution: { parameters: { commitPaths: ['a.txt'], commitDiff: 'diff' } } })
      expect(preview).toHaveBeenCalledWith(base.workspacePath, undefined, true)
      expect(base.requestApproval).not.toHaveBeenCalled()
    } finally {
      preview.mockRestore()
    }
  })
})

describe('runToolGates version refresh', () => {
  const base = {
    agentMode: 'auto' as const,
    fsmMode: { isToolAllowed: vi.fn(() => true) } as never,
    workspacePath: 'C:\\workspace',
    stepCount: 3,
    episodicCompactor: { recordStep: vi.fn() } as never,
    capabilityPolicyMode: 'network-approved' as const,
    emitLog: vi.fn(),
    requestApproval: vi.fn(),
    allowedToolsForTurn: ['read_file'] as const,
    requiredReadPath: 'src/App.tsx',
  }

  it('performs the required read itself instead of a read of another file', async () => {
    const result = await runToolGates({
      ...base,
      parsedTool: { tool: 'read_file', parameters: { filePath: 'src/Other.tsx' } },
    })
    expect(result).toEqual({ outcome: 'allowed', toolCallForExecution: { tool: 'read_file', parameters: { filePath: 'src/App.tsx' } } })
  })

  it('performs the required read itself instead of another edit, which the turn policy would refuse', async () => {
    const result = await runToolGates({
      ...base,
      parsedTool: { tool: 'write_file', parameters: { filePath: 'package.json', content: '{}' } },
    })
    expect(result).toEqual({ outcome: 'allowed', toolCallForExecution: { tool: 'read_file', parameters: { filePath: 'src/App.tsx' } } })
    expect(base.requestApproval).not.toHaveBeenCalled()
  })

  it('accepts the required file read', async () => {
    const result = await runToolGates({
      ...base,
      parsedTool: { tool: 'read_file', parameters: { filePath: 'src/App.tsx' } },
    })
    expect(result.outcome).toBe('allowed')
  })
})

describe('turn policy denials', () => {
  it('record a tool_policy guard and stop on the no-mutation budget instead of the step budget', async () => {
    const state = { guardEvents: [] as AgentGuardEvent[], progress: new AgentProgressPolicy() }
    const closeApplicationRun = vi.fn(async () => ({
      outcome: 'closed' as const,
      result: { success: false, summary: 'stopped', completionStatus: 'blocked' as const },
    }))

    for (let step = 1; step < PROGRESS_BUDGET.stepsWithoutMutation; step++) {
      expect(await recordToolPolicyDenial(state, step, closeApplicationRun)).toBeNull()
    }
    const result = await recordToolPolicyDenial(state, PROGRESS_BUDGET.stepsWithoutMutation, closeApplicationRun)

    expect(result).toMatchObject({ completionStatus: 'blocked' })
    expect(closeApplicationRun).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'guard_stop', guard: 'no_mutation' }))
    expect(state.guardEvents.every((event) => event.guard === 'tool_policy' && event.action === 'advise')).toBe(true)
  })
})

describe('runToolGates shell reads', () => {
  const baseCtx = (command: string, allowedToolsForTurn: string[] | undefined) => ({
    parsedTool: { tool: 'run_command' as const, parameters: { command } },
    agentMode: 'auto' as const,
    fsmMode: { isToolAllowed: vi.fn(() => true) } as never,
    workspacePath: 'D:/work/app',
    stepCount: 16,
    episodicCompactor: { recordStep: vi.fn() } as never,
    capabilityPolicyMode: 'network-approved' as const,
    emitLog: vi.fn(),
    requestApproval: vi.fn(),
    allowedToolsForTurn: allowedToolsForTurn as never,
  })

  it('runs a single-file shell read as read_file, even where only read_file is exposed', async () => {
    expect(await runToolGates(baseCtx("sed -n '1,200p' package.json", ['run_command']))).toEqual({
      outcome: 'allowed',
      toolCallForExecution: { tool: 'read_file', parameters: { filePath: 'package.json' } },
    })
    expect(await runToolGates(baseCtx('cat src/App.tsx', ['read_file']))).toMatchObject({
      toolCallForExecution: { tool: 'read_file', parameters: { filePath: 'src/App.tsx' } },
    })
  })

  it('keeps the turn policy for a read the phase does not allow, and ignores files outside the workspace', async () => {
    expect(await runToolGates(baseCtx('cat src/App.tsx', ['write_file']))).toMatchObject({ outcome: 'denied', policyDenial: 'turn_policy' })
    expect(await runToolGates(baseCtx('cat ../secrets.txt', ['run_command']))).toMatchObject({
      outcome: 'allowed',
      toolCallForExecution: { tool: 'run_command' },
    })
  })
})
