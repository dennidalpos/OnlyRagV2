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
  /** Files the segment writes through `>`, `>>` or `2>` redirection. */
  redirectTargets: string[]
}

/** Redirections that only merge or discard streams; they write no file. */
const STREAM_MERGES = /(?:^|\s)(?:[1-6*]?>&[12]|[1-6*]?>>?\s*\$null)(?=\s|$)/g

/**
 * Splits on `;`, `|` and `&&` outside quotes. PowerShell 5.1 has no `&&`: the shell session rewrites
 * it (powerShellCommand.ts), so it is a separator here. `||` and a lone `&` (call operator or
 * background job) stay refused.
 */
function splitCommands(command: string): string[] | { refused: string } {
  const parts: string[] = []
  let quote = ''
  let current = ''
  for (let index = 0; index < command.length; index++) {
    const char = command[index]
    if ((char === '"' || char === "'") && command[index - 1] !== '`') quote = quote === char ? '' : quote || char
    if (!quote && char === '&' && command[index + 1] === '&') {
      if (current.trim()) parts.push(current.trim())
      current = ''
      index++
      continue
    }
    if (!quote && char === '|' && command[index + 1] === '|')
      return { refused: '"||" is not supported by Windows PowerShell 5.1; run the commands separately.' }
    if (!quote && (char === ';' || char === '|')) {
      if (current.trim()) parts.push(current.trim())
      current = ''
      continue
    }
    if (!quote && char === '&') return { refused: 'The "&" call operator and background jobs are not allowed; call the program directly.' }
    current += char
  }
  if (quote) return { refused: 'The command has an unterminated quote.' }
  if (current.trim()) parts.push(current.trim())
  return parts
}

interface Token {
  text: string
  /** A quoted token is a literal argument: `">fix"` is a commit message, not a redirection. */
  quoted: boolean
}

function tokenize(command: string): Token[] | null {
  const tokens: Token[] = []
  let quote = ''
  let token = ''
  let quoted = false
  for (let index = 0; index < command.length; index++) {
    const char = command[index]
    if ((char === '"' || char === "'") && command[index - 1] !== '`') {
      quote = quote === char ? '' : quote || char
      quoted = true
      continue
    }
    if (!quote && /\s/.test(char)) {
      if (token || quoted) tokens.push({ text: token, quoted })
      token = ''
      quoted = false
      continue
    }
    token += char
  }
  if (quote) return null
  if (token || quoted) tokens.push({ text: token, quoted })
  return tokens
}

/** `$env:NAME` reads and assignments, and PowerShell's constant automatic variables, are static. */
const STATIC_DOLLAR_TOKEN = /^(?:\$env:[A-Za-z_][A-Za-z0-9_]*(?:=.*)?|\$null|\$true|\$false|\$LASTEXITCODE|\$\?)$/i

function isDynamicToken(token: Token): boolean {
  // Single-quoted text is literal in PowerShell, but double quotes expand: both are checked.
  if (token.text.includes('`')) return true
  if (!token.text.includes('$')) return false
  return !STATIC_DOLLAR_TOKEN.test(token.text)
}

/** Pulls `> file`, `>> file` and `2> file` out of a segment's tokens. */
function extractRedirects(tokens: Token[]): { tokens: string[]; redirectTargets: string[] } {
  const kept: string[] = []
  const redirectTargets: string[] = []
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    const match = token.quoted ? null : token.text.match(/^[1-6*]?>>?(.*)$/)
    if (!match) {
      kept.push(token.text)
      continue
    }
    const target = match[1] || tokens[++index]?.text || ''
    redirectTargets.push(target)
  }
  return { tokens: kept, redirectTargets }
}

type ParseResult = ParsedCommand[] | { refused: string }

function parseCommands(command: string): ParseResult {
  const parts = splitCommands(command.replace(STREAM_MERGES, ' '))
  if (!Array.isArray(parts)) return parts
  const parsed: ParsedCommand[] = []
  for (const part of parts) {
    const tokens = tokenize(part)
    if (!tokens?.length) return { refused: 'The command could not be parsed.' }
    if (tokens.some(isDynamicToken)) {
      return { refused: 'Variables, subexpressions and escapes other than $env:NAME are not allowed; write literal values.' }
    }
    const { tokens: kept, redirectTargets } = extractRedirects(tokens)
    if (!kept.length) return { refused: 'The command could not be parsed.' }
    parsed.push({ name: kept[0].toLowerCase(), args: kept.slice(1), redirectTargets })
  }
  return parsed
}

function pathTargets(args: readonly string[]): string[] {
  const targets: string[] = []
  const optionsWithValue = new Set(['-path', '-literalpath', '-destination', '-itemtype', '-filter', '-exclude', '-include', '-value', '-name', '-newname'])
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

/** Resolves a command's path argument against the shell's working directory (`base`, default the workspace root). */
function resolveTarget(target: string, workspacePath: string, base?: string): string {
  return path.resolve(base ?? path.resolve(workspacePath), target)
}

function staysInWorkspace(target: string, workspacePath: string | null | undefined, allowRoot = false, base?: string): boolean {
  if (!workspacePath || !target || target === '*' || target.includes('$')) return false
  const root = path.resolve(workspacePath)
  const resolved = resolveTarget(target, workspacePath, base)
  return isPathWithinRoot(root, resolved) && (allowRoot || resolved !== root)
}

function targetsStayInWorkspace(args: readonly string[], workspacePath?: string | null, base?: string): boolean {
  const targets = pathTargets(args)
  return targets.length > 0 && targets.every((target) => staysInWorkspace(target, workspacePath, false, base))
}

/** Commands (and their aliases) that delete, move or overwrite workspace files. */
const DESTRUCTIVE_FILE_COMMANDS = new Set([
  'remove-item',
  'rm',
  'rmdir',
  'rd',
  'ri',
  'del',
  'erase',
  'set-content',
  'sc',
  'add-content',
  'ac',
  'clear-content',
  'clc',
  'out-file',
  'tee',
  'tee-object',
  'move-item',
  'mv',
  'move',
  'mi',
  'rename-item',
  'ren',
  'rni',
  'copy-item',
  'cp',
  'copy',
  'cpi',
  'new-item',
  'ni',
])

/** Directory creation cannot lose data; inside the workspace it needs no approval. */
const DIRECTORY_COMMANDS = new Set(['mkdir', 'md'])

const LOCATION_COMMANDS = new Set(['cd', 'chdir', 'set-location', 'sl', 'push-location', 'pushd'])

/** Programs that run code passed inline: the code itself escapes every check here, so the user decides. */
function runsInlineCode(name: string, args: readonly string[]): boolean {
  const program = name.replace(/\.exe$/, '')
  const lower = args.map((arg) => arg.toLowerCase())
  if (program === 'cmd') return lower.some((arg) => arg === '/c' || arg === '/k')
  if (program === 'powershell' || program === 'pwsh') return lower.some((arg) => ['-c', '-command', '-e', '-ec', '-encodedcommand', '-file'].includes(arg))
  if (program === 'node' || program === 'deno' || program === 'bun') return lower.some((arg) => ['-e', '--eval', '-p', '--print'].includes(arg))
  if (/^python[0-9.]*$/.test(program) || program === 'py') return lower.includes('-c')
  if (program === 'bash' || program === 'sh' || program === 'wsl') return true
  return false
}

const GIT_GLOBAL_OPTIONS_WITH_VALUE = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace'])

function inspectGit(args: readonly string[], workspacePath?: string | null, base?: string): StructuredCommandSafetyResult {
  let index = 0
  while (index < args.length && args[index].startsWith('-')) {
    const option = args[index]
    if (option === '-C' && !staysInWorkspace(args[index + 1] || '', workspacePath, true, base)) {
      return { allowed: false, requiresApproval: false, reason: 'git -C must point inside the workspace.' }
    }
    index += GIT_GLOBAL_OPTIONS_WITH_VALUE.has(option) ? 2 : 1
  }
  const action = (args[index] || '').toLowerCase()
  const rest = args.slice(index + 1).map((arg) => arg.toLowerCase())
  const reject = (operation: string): StructuredCommandSafetyResult => ({
    allowed: false,
    requiresApproval: false,
    reason: `Destructive command pattern detected: ${operation}.`,
  })
  if (action === 'reset' && rest.includes('--hard')) return reject('git reset --hard')
  if (action === 'clean' && rest.some((arg) => /^-[a-z]*f/.test(arg) || arg === '--force')) return reject('git clean -f')
  if (action === 'restore' || (action === 'checkout' && (rest.includes('--') || rest.includes('.')))) return reject(`git ${action}`)
  if (action === 'push' && rest.some((arg) => arg === '--force' || arg === '-f' || arg.startsWith('--force-') || arg.startsWith('+')))
    return reject('git push --force')
  if (action === 'branch' && rest.some((arg) => arg === '-d' || arg === '--delete')) return reject('git branch -D')
  return { allowed: true, requiresApproval: false }
}

/** `nextDirectory` is where a location command leaves the shell, for the segments that follow it. */
function inspectCommand(command: ParsedCommand, workspacePath?: string | null, base?: string): StructuredCommandSafetyResult & { nextDirectory?: string } {
  const { name, args, redirectTargets } = command
  let requiresApproval = false

  for (const target of redirectTargets) {
    if (!staysInWorkspace(target, workspacePath, false, base))
      return { allowed: false, requiresApproval: false, reason: `Output redirection outside the workspace rejected: ${target || '(missing)'}.` }
    requiresApproval = true
  }

  if (DESTRUCTIVE_FILE_COMMANDS.has(name)) {
    const createsDirectory =
      (name === 'new-item' || name === 'ni') && args.some((arg, index) => arg.toLowerCase() === '-itemtype' && /^dir/i.test(args[index + 1] || ''))
    if (!targetsStayInWorkspace(args, workspacePath, base)) {
      return { allowed: false, requiresApproval: false, reason: `Workspace confinement rejected ${name}.` }
    }
    return { allowed: true, requiresApproval: requiresApproval || !createsDirectory }
  }

  if (DIRECTORY_COMMANDS.has(name)) {
    if (!targetsStayInWorkspace(args, workspacePath, base))
      return { allowed: false, requiresApproval: false, reason: `Workspace confinement rejected ${name}.` }
    return { allowed: true, requiresApproval }
  }

  if (LOCATION_COMMANDS.has(name)) {
    const target = pathTargets(args)[0] || ''
    if (!workspacePath || !staysInWorkspace(target, workspacePath, true, base)) {
      return { allowed: false, requiresApproval: false, reason: `${name} may only change to a directory inside the workspace.` }
    }
    return { allowed: true, requiresApproval, nextDirectory: resolveTarget(target, workspacePath, base) }
  }

  if (
    [
      'format',
      'clear-disk',
      'invoke-expression',
      'iex',
      'invoke-command',
      'icm',
      'start-process',
      'saps',
      'start',
      'stop-process',
      'spps',
      'kill',
      'taskkill',
    ].includes(name)
  ) {
    return { allowed: false, requiresApproval: false, reason: `Unsafe command invocation rejected: ${name}.` }
  }

  if (runsInlineCode(name, args)) return { allowed: true, requiresApproval: true }

  if (name === 'git') {
    const git = inspectGit(args, workspacePath, base)
    return git.allowed ? { allowed: true, requiresApproval: requiresApproval || git.requiresApproval } : git
  }
  return { allowed: true, requiresApproval }
}

/** Parses PowerShell-style command segments and classifies mutable operations without regex matching. */
export function inspectStructuredCommand(command: string, workspacePath?: string | null, currentDirectory?: string): StructuredCommandSafetyResult {
  const parsed = parseCommands(command)
  if (!Array.isArray(parsed)) return { allowed: false, requiresApproval: false, reason: parsed.refused }
  // Relative paths resolve where the shell stands: a `cd` persists between commands and within one.
  let base =
    workspacePath && currentDirectory && isPathWithinRoot(path.resolve(workspacePath), path.resolve(currentDirectory))
      ? path.resolve(currentDirectory)
      : undefined
  let requiresApproval = false
  for (const entry of parsed) {
    const { nextDirectory, ...result } = inspectCommand(entry, workspacePath, base)
    if (!result.allowed) return result
    requiresApproval ||= result.requiresApproval
    if (nextDirectory) base = nextDirectory
  }
  return { allowed: true, requiresApproval }
}
