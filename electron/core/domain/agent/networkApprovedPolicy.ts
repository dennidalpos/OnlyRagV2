import {
  capabilityPolicyAuditEventSchema,
  capabilityPolicyDecisionSchema,
  capabilityPolicyRequestSchema,
  type CapabilityPolicyAuditEvent,
  type CapabilityPolicyDecision,
  type CapabilityPolicyRequest,
  type CapabilityPolicyGateway,
} from './capabilityPolicyContract'
import { shellCommandHasEgress } from './offlineStrictPolicy'
import type { CapabilityPolicyAuditRepository } from '../../infrastructure/logging/capabilityPolicyAuditRepository'

function auditIdFor(request: CapabilityPolicyRequest): string {
  return `policy-${request.sessionId}-${request.toolName}-${request.operation}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 200)
}

function result(request: CapabilityPolicyRequest, allowed: boolean, requiresConsent: boolean, reason: string): CapabilityPolicyDecision {
  return capabilityPolicyDecisionSchema.parse({ allowed, requiresConsent, reason, auditId: auditIdFor(request) })
}

export function authorizeNetworkApproved(input: CapabilityPolicyRequest): CapabilityPolicyDecision {
  const request = capabilityPolicyRequestSchema.parse(input)

  if (request.mode !== 'network-approved') {
    return result(request, false, false, 'Only network-approved authorization is implemented by this gateway')
  }

  const networkOperation = request.capability === 'http-download' || request.capability === 'browser' ||
    (request.capability === 'git' && ['connect', 'download'].includes(request.operation)) ||
    (request.capability === 'shell' && request.operation === 'execute' && shellCommandHasEgress(request.target || ''))

  if (!networkOperation) return result(request, true, false, 'Local capability allowed in network-approved mode')
  if (!request.consent.requested || !request.consent.granted || !request.consent.consentId) {
    return result(request, false, true, 'Explicit consent is required before network egress')
  }

  return result(request, true, true, 'Network capability allowed with explicit consent')
}

export function buildCapabilityPolicyAuditEvent(
  input: CapabilityPolicyRequest,
  decision: CapabilityPolicyDecision,
  timestamp: string,
): CapabilityPolicyAuditEvent {
  const request = capabilityPolicyRequestSchema.parse(input)
  const parsedDecision = capabilityPolicyDecisionSchema.parse(decision)
  return capabilityPolicyAuditEventSchema.parse({
    auditId: parsedDecision.auditId,
    sessionId: request.sessionId,
    timestamp,
    capability: request.capability,
    operation: request.operation,
    toolName: request.toolName,
    target: request.target,
    mode: request.mode,
    allowed: parsedDecision.allowed,
    reason: parsedDecision.reason,
    consentId: request.consent.consentId,
  })
}

/** In-process audit sink for policy decisions; durable retention is intentionally a later task. */
export class NetworkApprovedPolicyGateway implements CapabilityPolicyGateway {
  private readonly events: CapabilityPolicyAuditEvent[] = []

  constructor(private readonly clock: () => string = () => new Date().toISOString()) {}

  public authorize(request: CapabilityPolicyRequest): CapabilityPolicyDecision {
    const decision = authorizeNetworkApproved(request)
    this.record(buildCapabilityPolicyAuditEvent(request, decision, this.clock()))
    return decision
  }

  public record(event: CapabilityPolicyAuditEvent): void {
    const parsed = capabilityPolicyAuditEventSchema.parse(event)
    this.events.push(parsed)
  }

  public getAuditEvents(): CapabilityPolicyAuditEvent[] {
    return this.events.map((event) => ({ ...event }))
  }
}

/** Application boundary for the durable audit path; authorization remains pure and testable. */
export async function authorizeAndPersistNetworkApproved(
  input: CapabilityPolicyRequest,
  repository: Pick<CapabilityPolicyAuditRepository, 'append'>,
  timestamp: string = new Date().toISOString(),
): Promise<CapabilityPolicyDecision> {
  const decision = authorizeNetworkApproved(input)
  const auditEvent = buildCapabilityPolicyAuditEvent(input, decision, timestamp)
  if (!(await repository.append(auditEvent))) {
    return result(input, false, decision.requiresConsent, 'Policy decision could not be persisted to the audit store')
  }
  return decision
}
