import { describe, expect, it, vi } from 'vitest'
import { runToolGates } from './agentOrchestratorToolGates'

describe('runToolGates network-approved policy', () => {
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
