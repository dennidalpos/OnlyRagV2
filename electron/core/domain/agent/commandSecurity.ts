import { sanitizePowerShellCommand } from './shellStreamGuard'
import { inspectStructuredCommand } from './structuredCommandSafety'

export interface SecurityCheckResult {
  isAllowed: boolean
  blockedReason?: string
  sanitizedCommand: string
  requiresApproval?: boolean
}

export function checkCommandSecurity(rawCmd: string, workspacePath?: string | null): SecurityCheckResult {
  if (!rawCmd || typeof rawCmd !== 'string') {
    return { isAllowed: false, blockedReason: 'Empty or invalid command parameter', sanitizedCommand: '' }
  }

  const trimmed = rawCmd.trim()

  // Cross-platform Unix -> PowerShell command translation
  const sanitized = sanitizePowerShellCommand(trimmed)
  const safety = inspectStructuredCommand(sanitized, workspacePath)
  if (!safety.allowed) {
    return {
      isAllowed: false,
      blockedReason: safety.reason || 'Structured command validation rejected the request.',
      sanitizedCommand: sanitized,
    }
  }

  return {
    isAllowed: true,
    sanitizedCommand: sanitized,
    requiresApproval: safety.requiresApproval,
  }
}
