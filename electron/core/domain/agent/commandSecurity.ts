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
  let sanitized = trimmed
  if (/^rm\s+-rf\s+(.+)$/i.test(sanitized)) {
    const target = sanitized.replace(/^rm\s+-rf\s+/i, '').trim()
    sanitized = `Remove-Item -Recurse -Force "${target}"`
  } else if (/^mkdir\s+-p\s+(.+)$/i.test(sanitized)) {
    const dir = sanitized.replace(/^mkdir\s+-p\s+/i, '').trim()
    sanitized = `New-Item -ItemType Directory -Path "${dir}" -Force`
  } else if (/^touch\s+(.+)$/i.test(sanitized)) {
    const file = sanitized.replace(/^touch\s+/i, '').trim()
    sanitized = `New-Item -ItemType File -Path "${file}" -Force`
  } else if (sanitized === 'ls -la' || sanitized === 'ls -l' || sanitized === 'ls') {
    sanitized = 'Get-ChildItem'
  }

  return {
    isAllowed: true,
    sanitizedCommand: sanitized,
  }
}
