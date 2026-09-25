export function normalizePowerShellCommand(command: string): string {
  if (!command || typeof command !== 'string') return ''
  let normalized = command.trim()

  normalized = normalized.replace(/^npx\s+(?!-y|--yes)(.+)/i, 'npx -y $1')

  if (/\bnpm\s+create\s+vite\b/i.test(normalized) || /\bcreate-vite\b/i.test(normalized)) {
    if (!normalized.includes('--yes') && !normalized.includes('-y')) {
      if (normalized.includes('--template') && !normalized.includes('-- --template')) {
        normalized = normalized.replace(/--template\s+([^\s]+)/i, '-- --template $1 --yes')
      } else {
        normalized = `${normalized} --yes`
      }
    }
  }

  if (normalized.includes('&&')) {
    const parts = normalized.split(/\s*&&\s*/)
    if (parts.length > 1) {
      normalized = parts.join('; if ($?) { ') + ' }'.repeat(parts.length - 1)
    }
  }

  return normalized
}
