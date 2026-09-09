import { describe, expect, it, vi } from 'vitest'
import { runToolGates } from './agentOrchestratorToolGates'

describe('runToolGates network-approved policy', () => {
  it('rejects a tool omitted from the current phase before approval or execution', async () => {
    const requestApproval = vi.fn()
    const recordStep = vi.fn()
    const result = await runToolGates({
      parsedTool: { tool: 'run_command', parameters: { command: 'npm test' } },
      agentMode: 'agent',
      fsmMode: { isToolAllowed: vi.fn(() => true) } as any,
      workspacePath: null,
      stepCount: 2,
      episodicCompactor: { recordStep } as any,
      emitLog: vi.fn(),
      requestApproval,
      allowedToolsForTurn: ['read_file'],
    })

    expect(result).toEqual({ outcome: 'denied' })
    expect(requestApproval).not.toHaveBeenCalled()
    expect(recordStep).toHaveBeenCalledOnce()
  })

  it('turns an explicit network approval into a one-use policy consent', async () => {
    const requestApproval = vi.fn().mockResolvedValue({ approved: true })

    const result = await runToolGates({
      parsedTool: { tool: 'web_search', parameters: { query: 'official documentation' } },
      agentMode: 'agent',
      fsmMode: { isToolAllowed: vi.fn(() => false) } as any,
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
})

describe('runToolGates version refresh', () => {
  const base = {
    agentMode: 'agent' as const,
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
