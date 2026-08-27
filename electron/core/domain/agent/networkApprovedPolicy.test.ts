import { describe, expect, it, vi } from 'vitest'
import { authorizeAndPersistNetworkApproved, authorizeNetworkApproved, buildCapabilityPolicyAuditEvent, NetworkApprovedPolicyGateway } from './networkApprovedPolicy'

const base = {
  sessionId: 'session-network',
  toolName: 'download_file',
  capability: 'http-download' as const,
  operation: 'download' as const,
  mode: 'network-approved' as const,
  workspaceRoot: 'D:/projects/demo',
  target: 'https://example.test/archive.zip',
}

describe('network-approved capability policy', () => {
  it('denies network access without explicit consent', () => {
    expect(authorizeNetworkApproved({ ...base, consent: { requested: false, granted: false } })).toMatchObject({
      allowed: false,
      requiresConsent: true,
    })
  })

  it('allows network access only with a requested and granted consent id', () => {
    const request = { ...base, consent: { requested: true, granted: true, consentId: 'consent-7' } }
    const decision = authorizeNetworkApproved(request)
    expect(decision).toMatchObject({ allowed: true, requiresConsent: true })

    expect(buildCapabilityPolicyAuditEvent(request, decision, '2026-08-27T15:00:00.000Z')).toMatchObject({
      sessionId: 'session-network',
      allowed: true,
      consentId: 'consent-7',
      capability: 'http-download',
    })
  })

  it('allows local filesystem operations without consent and blocks remote shell egress', () => {
    expect(authorizeNetworkApproved({ ...base, capability: 'filesystem', operation: 'read', toolName: 'read_file', consent: { requested: false, granted: false } }).allowed).toBe(true)
    expect(authorizeNetworkApproved({ ...base, capability: 'shell', operation: 'execute', toolName: 'run_command', target: 'git push origin main', consent: { requested: false, granted: false } }).allowed).toBe(false)
  })

  it('records every gateway decision as a validated audit event', () => {
    const gateway = new NetworkApprovedPolicyGateway(() => '2026-08-27T15:00:00.000Z')
    const decision = gateway.authorize({ ...base, consent: { requested: false, granted: false } })
    const events = gateway.getAuditEvents()

    expect(decision.allowed).toBe(false)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ auditId: decision.auditId, allowed: false, timestamp: '2026-08-27T15:00:00.000Z' })
  })

  it('persists the decision before returning it to an external caller', async () => {
    const append = vi.fn().mockResolvedValue(true)
    const decision = await authorizeAndPersistNetworkApproved(
      { ...base, consent: { requested: false, granted: false } },
      { append },
      '2026-08-27T15:00:00.000Z',
    )

    expect(decision.allowed).toBe(false)
    expect(append).toHaveBeenCalledOnce()
  })
})
