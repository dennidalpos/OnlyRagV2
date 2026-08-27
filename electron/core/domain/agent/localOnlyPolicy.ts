import {
  capabilityPolicyDecisionSchema,
  capabilityPolicyRequestSchema,
  type CapabilityPolicyDecision,
  type CapabilityPolicyRequest,
} from './capabilityPolicyContract'
import { shellCommandHasEgress } from './offlineStrictPolicy'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export function isLoopbackTarget(target: string): boolean {
  try {
    const url = new URL(target)
    return LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

function auditIdFor(request: CapabilityPolicyRequest): string {
  return `policy-${request.sessionId}-${request.toolName}-${request.operation}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 200)
}

function result(request: CapabilityPolicyRequest, allowed: boolean, reason: string): CapabilityPolicyDecision {
  return capabilityPolicyDecisionSchema.parse({ allowed, reason, requiresConsent: false, auditId: auditIdFor(request) })
}

export function authorizeLocalOnly(input: CapabilityPolicyRequest): CapabilityPolicyDecision {
  const request = capabilityPolicyRequestSchema.parse(input)

  if (request.mode !== 'local-only') {
    return result(request, false, 'Only local-only authorization is implemented by this gateway')
  }

  if (request.capability === 'browser' || request.capability === 'http-download') {
    if (!request.target || !isLoopbackTarget(request.target)) {
      return result(request, false, 'Only loopback network targets are allowed in local-only mode')
    }
    return result(request, true, 'Loopback network target allowed in local-only mode')
  }

  if (request.capability === 'git' && ['connect', 'download'].includes(request.operation)) {
    return result(request, false, 'Git remote access is not allowed in local-only mode')
  }

  if (request.capability === 'shell' && request.operation === 'execute' && shellCommandHasEgress(request.target || '') && !isLoopbackTarget(request.target || '')) {
    return result(request, false, 'Shell command targets external network in local-only mode')
  }

  return result(request, true, 'Local capability allowed in local-only mode')
}
