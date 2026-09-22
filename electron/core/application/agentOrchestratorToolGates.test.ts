import { describe, expect, it, vi } from 'vitest'
import { runToolGates } from './agentOrchestratorToolGates'

describe('runToolGates network-approved policy', () => {
  it('rejects a tool omitted from the current phase before approval or execution', async () => {
    const requestApproval = vi.fn()
    const recordStep = vi.fn()
    const result = await runToolGates({
      parsedTool: { tool: 'run_command', parameters: { command: 'npm test' } },
      agentMode: 'auto',
      fsmMode: { isToolAllowed: vi.fn(() => true) } as any,
      workspacePath: null,
      stepCount: 2,
      episodicCompactor: { recordStep } as any,
      emitLog: vi.fn(),
      requestApproval,
      allowedToolsForTurn: ['read_file'],
    })

    expect(result).toMatchObject({ outcome: 'denied', feedback: expect.stringContaining('[TURN TOOL POLICY DENIED]') })
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
      } as any,
      workspacePath: null,
      stepCount: 4,
      episodicCompactor: { recordStep: vi.fn() } as any,
      emitLog: vi.fn(),
      requestApproval,
      capabilityPolicyMode: 'network-approved',
    })

    expect(requestApproval).toHaveBeenCalledOnce()
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
      } as any,
      workspacePath: 'C:\\workspace',
      stepCount: 5,
      episodicCompactor: { recordStep: vi.fn() } as any,
      emitLog: vi.fn(),
      requestApproval,
      capabilityPolicyMode: 'network-approved',
    })

    expect(requestApproval).not.toHaveBeenCalled()
    expect(result).toEqual({ outcome: 'denied' })
  })

  it('combines Guided mutation and network consent into one review', async () => {
    const requestApproval = vi.fn().mockResolvedValue({ approved: true })
    const result = await runToolGates({
      parsedTool: { tool: 'download_file', parameters: { url: 'https://example.test/data.txt', filePath: 'data.txt' } },
      agentMode: 'guided',
      fsmMode: { isToolAllowed: vi.fn(() => true) } as any,
      workspacePath: 'C:\\workspace',
      stepCount: 5,
      episodicCompactor: { recordStep: vi.fn() } as any,
      emitLog: vi.fn(),
      requestApproval,
      capabilityPolicyMode: 'network-approved',
    })

    expect(requestApproval).toHaveBeenCalledOnce()
    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({ reasons: expect.arrayContaining(['network access', 'Guided review']) }))
    expect(result).toMatchObject({ outcome: 'allowed', policyConsent: { requested: true, granted: true } })
  })
})

describe('runToolGates structured command safety', () => {
  const base = {
    agentMode: 'auto' as const,
    fsmMode: { isToolAllowed: vi.fn(() => true) } as any,
    workspacePath: 'C:\\workspace',
    stepCount: 6,
    episodicCompactor: { recordStep: vi.fn() } as any,
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
      parsedTool: { tool: 'run_command', parameters: { command: 'Remove-Item -Recurse -Force C:\\' } },
    })

    expect(result).toEqual({ outcome: 'denied' })
    expect(requestApproval).not.toHaveBeenCalled()
  })
})

describe('runToolGates version refresh', () => {
  const base = {
    agentMode: 'auto' as const,
    fsmMode: { isToolAllowed: vi.fn(() => true) } as any,
    workspacePath: 'C:\\workspace',
    stepCount: 3,
    episodicCompactor: { recordStep: vi.fn() } as any,
    emitLog: vi.fn(),
    requestApproval: vi.fn(),
    allowedToolsForTurn: ['read_file'] as const,
    requiredReadPath: 'src/App.tsx',
  }

  it('rejects a read of another file', async () => {
    const result = await runToolGates({
      ...base,
      parsedTool: { tool: 'read_file', parameters: { filePath: 'src/Other.tsx' } },
    })
    expect(result.outcome).toBe('denied')
  })

  it('accepts the required file read', async () => {
    const result = await runToolGates({
      ...base,
      parsedTool: { tool: 'read_file', parameters: { filePath: 'src/App.tsx' } },
    })
    expect(result.outcome).toBe('allowed')
  })
})
