import { describe, expect, it } from 'vitest'
import {
  capabilityPolicyAuditEventSchema,
  capabilityPolicyDecisionSchema,
  capabilityPolicyRequestSchema,
} from './capabilityPolicyContract'

const REQUEST = {
  sessionId: 'session-42',
  toolName: 'download_file',
  capability: 'http-download' as const,
  operation: 'download' as const,
  mode: 'network-approved' as const,
  workspaceRoot: 'D:/projects/demo',
  target: 'https://example.test/archive.zip',
  consent: { requested: true, granted: true, consentId: 'consent-1' },
  limits: { maxBytes: 10_000_000, timeoutMs: 30_000 },
}

describe('CapabilityPolicyGateway contract', () => {
  it('accepts an explicitly consented network download request', () => {
    expect(capabilityPolicyRequestSchema.safeParse(REQUEST).success).toBe(true)
  })

  it('accepts a denied decision and a structured audit event', () => {
    expect(capabilityPolicyDecisionSchema.safeParse({
      allowed: false,
      reason: 'Network access is disabled in offline-strict mode',
      requiresConsent: false,
      auditId: 'audit-1',
    }).success).toBe(true)

    expect(capabilityPolicyAuditEventSchema.safeParse({
      auditId: 'audit-1',
      sessionId: 'session-42',
      timestamp: '2026-08-27T15:00:00.000Z',
      capability: 'http-download',
      operation: 'download',
      toolName: 'download_file',
      target: 'https://example.test/archive.zip',
      mode: 'offline-strict',
      allowed: false,
      reason: 'Network access is disabled in offline-strict mode',
    }).success).toBe(true)
  })

  it('rejects consent grants without a request or consent id', () => {
    const result = capabilityPolicyRequestSchema.safeParse({
      ...REQUEST,
      consent: { requested: false, granted: true },
    })
    expect(result.success).toBe(false)
  })

  it('rejects unknown capabilities, unsupported modes, unsafe limits and extra fields', () => {
    const result = capabilityPolicyRequestSchema.safeParse({
      ...REQUEST,
      capability: 'filesystem',
      mode: 'auto',
      limits: { maxBytes: 0 },
      unexpected: true,
    })
    expect(result.success).toBe(false)
  })
})
