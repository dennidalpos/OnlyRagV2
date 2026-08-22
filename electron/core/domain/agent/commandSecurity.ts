import { sanitizePowerShellCommand } from './shellStreamGuard'

export interface SecurityCheckResult {
  isAllowed: boolean
  blockedReason?: string
  sanitizedCommand: string
}

const DESTRUCTIVE_PATTERNS = [
  /git\s+reset\s+--hard/i,
  /git\s+clean\s+-[a-z]*f/i,
  /git\s+push\s+.*--force/i,
  /git\s+push\s+.*-f\b/i,
  /git\s+restore\s+\./i,
  /git\s+checkout\s+--\s+\./i,
  /rm\s+-rf\s+[\/\*\.]/i,
  /remove-item\s+.*-force\s+.*[\/\*\.\\]/i,
  /remove-item\s+.*[c-z]:/i,
  /del\s+\/[fsq]\s+/i,
  /format\s+[c-z]:/i,
  /taskkill\s+\/f\s+\/im\s+(svchost|explorer|csrss)\.exe/i,
]

export function checkCommandSecurity(rawCmd: string): SecurityCheckResult {
  if (!rawCmd || typeof rawCmd !== 'string') {
    return { isAllowed: false, blockedReason: 'Empty or invalid command parameter', sanitizedCommand: '' }
  }

  const trimmed = rawCmd.trim()

  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isAllowed: false,
        blockedReason: `Destructive command pattern detected ("${trimmed}"). Execution forbidden by security policy.`,
        sanitizedCommand: trimmed,
      }
    }
  }

  // Cross-platform Unix -> PowerShell command translation
  const sanitized = sanitizePowerShellCommand(trimmed)

  return {
    isAllowed: true,
    sanitizedCommand: sanitized,
  }
}
