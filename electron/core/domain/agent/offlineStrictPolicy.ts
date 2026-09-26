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
  /\b(?:pnpm|yarn)\s+dlx\b|\bbunx\b/i,
  /^\s*(?:yarn|pnpm\s+i)\s*$/i,
  /\b(?:pip|pip3|uv|poetry)\s+(?:install|add|download|sync)\b/i,
  /\bpython[0-9.]*\s+-m\s+pip\s+install\b/i,
  /\b(?:cargo\s+(?:install|add|fetch)|go\s+(?:get|install|mod\s+download))\b/i,
  /\b(?:ssh|scp|sftp|ftp)\b/i,
  /\b(?:netcat|nc)\b/i,
  /https?:\/\//i,
]

/** A package spec without its version: `vite@8` -> `vite`, `@scope/cli@1` -> `@scope/cli`. */
function withoutVersion(spec: string): string {
  const at = spec.indexOf('@', spec.startsWith('@') ? 1 : 0)
  return at === -1 ? spec : spec.slice(0, at)
}

/**
 * The commands `npx` is asked to run in a shell line, versions stripped. npx downloads any of them that
 * no installed package provides, so each is network use unless it is in node_modules/.bin. Segments
 * with --no-install, --no or --offline are left out: npx then refuses to download.
 */
export function npxCommandNames(command: string): string[] {
  const names: string[] = []
  for (const segment of command.split(/[;&|\n]+/)) {
    const tokens = segment.trim().split(/\s+/)
    if (!/^npx(?:\.cmd)?$/i.test(tokens[0] || '')) continue
    if (tokens.some((token) => token === '--no-install' || token === '--no' || token === '--offline')) continue
    for (let index = 1; index < tokens.length; index++) {
      const token = tokens[index]
      if (token === '-p' || token === '--package') {
        if (tokens[index + 1]) names.push(withoutVersion(tokens[++index]))
        continue
      }
      if (token.startsWith('--package=')) {
        names.push(withoutVersion(token.slice('--package='.length)))
        continue
      }
      if (token.startsWith('-')) continue
      names.push(withoutVersion(token))
      break
    }
  }
  return names.filter(Boolean)
}

/** True when the command can reach the network; `localBinaries` names the npx commands the workspace already provides. */
export function shellCommandHasEgress(command: string, localBinaries: readonly string[] = []): boolean {
  if (EGRESS_COMMAND_PATTERNS.some((pattern) => pattern.test(command))) return true
  return npxCommandNames(command).some((name) => !localBinaries.includes(name))
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

  if (request.capability === 'shell' && request.operation === 'execute' && shellCommandHasEgress(request.target || '', request.localBinaries)) {
    return decision(request, false, 'Shell command would create network egress in offline-strict mode')
  }

  if (request.capability === 'git' && ['connect', 'download'].includes(request.operation)) {
    return decision(request, false, 'Git network access is disabled in offline-strict mode')
  }

  return decision(request, true, 'Local capability allowed in offline-strict mode')
}
