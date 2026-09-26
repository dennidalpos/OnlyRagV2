import {
  capabilityPolicyDecisionSchema,
  capabilityPolicyRequestSchema,
  type CapabilityPolicyDecision,
  type CapabilityPolicyRequest,
} from './capabilityPolicyContract'

const EGRESS_COMMAND_PATTERNS = [
  /\b(?:curl|wget|fetch|Invoke-WebRequest|Invoke-RestMethod|Start-BitsTransfer|iwr|irm)\b/i,
  /\b(?:git\s+(?:clone|fetch|pull|push|remote\s+add|submodule|ls-remote))\b/i,
  /\b(?:npm|pnpm|yarn|npx|bun)\s+(?:install|i|ci|add|update|upgrade|publish|exec)\b/i,
  /^\s*(?:yarn|pnpm\s+i)\s*$/i,
  /\b(?:pip|pip3|uv|poetry)\s+(?:install|add|download|sync)\b/i,
  /\bpython[0-9.]*\s+-m\s+pip\s+install\b/i,
  /\b(?:cargo\s+(?:install|add|fetch)|go\s+(?:get|install|mod\s+download))\b/i,
  /\b(?:ssh|scp|sftp|ftp)\b/i,
  /\b(?:netcat|nc)\b/i,
  /https?:\/\//i,
]

export function shellCommandHasEgress(command: string): boolean {
  return EGRESS_COMMAND_PATTERNS.some((pattern) => pattern.test(command))
}

function auditIdFor(request: CapabilityPolicyRequest): string {
  return `policy-${request.sessionId}-${request.toolName}-${request.operation}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 200)
}

function decision(request: CapabilityPolicyRequest, allowed: boolean, reason: string): CapabilityPolicyDecision {
  return capabilityPolicyDecisionSchema.parse({
    allowed,
    reason,
    requiresConsent: false,
    auditId: auditIdFor(request),
  })
}

/** Strict offline policy: no network-capable operation can reach an effectful adapter. */
export function authorizeOfflineStrict(input: CapabilityPolicyRequest): CapabilityPolicyDecision {
  const request = capabilityPolicyRequestSchema.parse(input)

  if (request.mode !== 'offline-strict') {
    return decision(request, false, 'Only offline-strict authorization is implemented by this gateway')
  }

  if (request.capability === 'http-download' || request.capability === 'browser') {
    return decision(request, false, 'Network egress is disabled in offline-strict mode')
  }

  if (request.capability === 'shell' && request.operation === 'execute' && shellCommandHasEgress(request.target || '')) {
    return decision(request, false, 'Shell command would create network egress in offline-strict mode')
  }

  if (request.capability === 'git' && ['connect', 'download'].includes(request.operation)) {
    return decision(request, false, 'Git network access is disabled in offline-strict mode')
  }

  return decision(request, true, 'Local capability allowed in offline-strict mode')
}
