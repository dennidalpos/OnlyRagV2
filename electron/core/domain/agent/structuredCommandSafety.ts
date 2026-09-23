import path from 'node:path'
import { isPathWithinRoot } from './pathContainment'

export interface StructuredCommandSafetyResult {
  allowed: boolean
  requiresApproval: boolean
  reason?: string
}

interface ParsedCommand {
  name: string
  args: string[]
}

function splitCommands(command: string): string[] | null {
  const parts: string[] = []
  let quote = ''
  let current = ''
  for (let index = 0; index < command.length; index++) {
    const char = command[index]
    if ((char === '"' || char === "'") && command[index - 1] !== '`') quote = quote === char ? '' : quote || char
    if (!quote && (char === ';' || char === '|')) {
      if (current.trim()) parts.push(current.trim())
      current = ''
      continue
    }
    if (!quote && char === '&') return null
    current += char
  }
  if (quote) return null
  if (current.trim()) parts.push(current.trim())
  return parts
}

function tokenize(command: string): string[] | null {
  const tokens: string[] = []
  let quote = ''
  let token = ''
  for (let index = 0; index < command.length; index++) {
    const char = command[index]
    if ((char === '"' || char === "'") && command[index - 1] !== '`') {
      quote = quote === char ? '' : quote || char
      continue
    }
    if (!quote && /\s/.test(char)) {
      if (token) tokens.push(token)
      token = ''
      continue
    }
    token += char
  }
  if (quote) return null
  if (token) tokens.push(token)
  return tokens
}

function parseCommands(command: string): ParsedCommand[] | null {
  const parts = splitCommands(command)
  if (!parts) return null
  const parsed: ParsedCommand[] = []
  for (const part of parts) {
    const tokens = tokenize(part)
    if (!tokens?.length || tokens.some((token) => token.includes('$') || token.includes('`'))) return null
    parsed.push({ name: tokens[0].toLowerCase(), args: tokens.slice(1) })
  }
  return parsed
}

function pathTargets(args: readonly string[]): string[] {
  const targets: string[] = []
  const optionsWithValue = new Set(['-path', '-literalpath', '-destination', '-itemtype', '-filter', '-exclude', '-include'])
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg.startsWith('-')) {
      const normalized = arg.toLowerCase()
      if (optionsWithValue.has(normalized) && args[index + 1]) {
        const value = args[++index]
        if (['-path', '-literalpath', '-destination'].includes(normalized)) targets.push(value)
      }
      continue
    }
    targets.push(arg)
  }
  return targets
}

function targetsStayInWorkspace(args: readonly string[], workspacePath?: string | null): boolean {
  if (!workspacePath) return false
  const root = path.resolve(workspacePath)
  const targets = pathTargets(args)
  if (targets.length === 0) return false
  return targets.every((target) => {
    if (!target || target === '.' || target === '*' || target.includes('$')) return false
    const resolved = path.resolve(root, target)
    return isPathWithinRoot(root, resolved) && resolved !== root
  })
}

function inspectCommand(command: ParsedCommand, workspacePath?: string | null): StructuredCommandSafetyResult {
  const { name, args } = command
  const isFileMutation = [
    'remove-item',
    'rm',
    'rmdir',
    'del',
    'erase',
    'set-content',
    'add-content',
    'out-file',
    'new-item',
    'move-item',
    'rename-item',
    'copy-item',
  ].includes(name)
  if (isFileMutation) {
    if (!targetsStayInWorkspace(args, workspacePath)) {
      return { allowed: false, requiresApproval: false, reason: `Workspace confinement rejected ${name}.` }
    }
    return { allowed: true, requiresApproval: true }
  }

  if (['format', 'clear-disk', 'invoke-expression', 'iex', 'invoke-command', 'start-process', 'stop-process', 'taskkill'].includes(name)) {
    return { allowed: false, requiresApproval: false, reason: `Unsafe command invocation rejected: ${name}.` }
  }

  if (name !== 'git') return { allowed: true, requiresApproval: false }
  const lowerArgs = args.map((arg) => arg.toLowerCase())
  const action = lowerArgs[0]
  const rejectDestructiveGit = (operation: string): StructuredCommandSafetyResult => ({
    allowed: false,
    requiresApproval: false,
    reason: `Destructive command pattern detected: ${operation}.`,
  })
  if (action === 'reset' && lowerArgs.includes('--hard')) return rejectDestructiveGit('git reset --hard')
  if (action === 'clean' && lowerArgs.some((arg) => arg.includes('f'))) return rejectDestructiveGit('git clean -f')
  if (action === 'restore' || (action === 'checkout' && lowerArgs.includes('--'))) return rejectDestructiveGit(`git ${action}`)
  if (action === 'push' && lowerArgs.some((arg) => arg === '--force' || arg === '-f')) return rejectDestructiveGit('git push --force')
  if (action === 'branch' && lowerArgs.includes('-d')) return rejectDestructiveGit('git branch -D')
  return { allowed: true, requiresApproval: false }
}

/** Parses PowerShell-style command segments and classifies mutable operations without regex matching. */
export function inspectStructuredCommand(command: string, workspacePath?: string | null): StructuredCommandSafetyResult {
  const parsed = parseCommands(command)
  if (!parsed) return { allowed: false, requiresApproval: false, reason: 'Dynamic, malformed, or chained command syntax is not allowed.' }
  let requiresApproval = false
  for (const entry of parsed) {
    const result = inspectCommand(entry, workspacePath)
    if (!result.allowed) return result
    requiresApproval ||= result.requiresApproval
  }
  return { allowed: true, requiresApproval }
}
