/** Validates commands for falsifiable, non-mutating verification. */

export interface VerificationCommandVerdict {
  /** True when the command may be executed as proof of a milestone. */
  isSafe: boolean
  /** Why it was refused, phrased for the plan note and the audit log. Absent when safe. */
  reason?: string
}

/** Mutating commands that write/delete files. */
const MUTATING_COMMANDS = new Set([
  'touch',
  'cp',
  'copy',
  'mv',
  'move',
  'rm',
  'del',
  'erase',
  'mkdir',
  'md',
  'rmdir',
  'rd',
  'dd',
  'truncate',
  'tee',
  'printf',
  'new-item',
  'ni',
  'set-content',
  'add-content',
  'clear-content',
  'out-file',
  'copy-item',
  'move-item',
  'remove-item',
  'rename-item',
  'tee-object',
])

/** Commands that exit 0 regardless of the workspace, so their exit code proves nothing. */
const VACUOUS_COMMANDS = new Set(['echo', 'true', ':', 'cd', 'exit', 'set-location', 'write-host', 'write-output'])

/** Existence/listing commands that prove no code behavior. */
const EXISTENCE_ONLY_COMMANDS = new Set(['cat', 'type', 'get-content', 'gc', 'head', 'tail', 'ls', 'dir', 'get-childitem', 'gci', 'test-path', 'stat'])

/** Interactive editors, pagers, and GUI openers. */
const INTERACTIVE_PROGRAMS = new Set([
  'nano',
  'vi',
  'vim',
  'nvim',
  'emacs',
  'pico',
  'ed',
  'edit',
  'less',
  'more',
  'man',
  'start',
  'open',
  'xdg-open',
  'explorer',
  'code',
  'code-insiders',
  'storybook',
  'start-storybook',
])

/** Checks for graphical-mode test runner invocations. */
function isGuiModeVerificationSegment(segment: string): boolean {
  const cmd = segment.trim().toLowerCase()
  if (!cmd) return false
  return (
    /\b(cypress|playwright|vitest|jest|nightwatch)\s+(open|--ui|--headed)\b/.test(cmd) ||
    /\b(cypress|playwright|vitest|jest|nightwatch)\b.*\s--(ui|headed)\b/.test(cmd)
  )
}

/** Checks for non-terminating dev/watch server commands. */
function isNonExitingVerificationSegment(segment: string): boolean {
  const cmd = segment.trim().toLowerCase()
  if (!cmd) return false

  if (/^(npm|pnpm|yarn|bun)\s+(install|i|add)\b/.test(cmd)) return false

  if (
    /^(npm|pnpm|yarn|bun)\s+(run\s+)?(build|test|lint|typecheck|check|format)\b/.test(cmd) ||
    /^(npx\s+)?(tsc|eslint|prettier|vitest\s+run|jest\s+--runInBand)\b/.test(cmd) ||
    /^(npx\s+)?vite\s+build\b/.test(cmd) ||
    /^(npx\s+)?next\s+build\b/.test(cmd)
  ) {
    return false
  }

  return (
    /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|preview)\b/.test(cmd) ||
    /^(npx\s+)?vite(\.js|\.cmd|\.exe)?(\s+(dev|serve|preview))?$/i.test(cmd) ||
    /\bnext\s+(dev|start)\b/.test(cmd) ||
    /\bng\s+serve\b/.test(cmd) ||
    /\bwebpack(-dev-server)?\s+serve\b/.test(cmd) ||
    /\bnodemon\b/.test(cmd) ||
    /\bflask\s+run\b/.test(cmd) ||
    /-m\s+http\.server\b/.test(cmd) ||
    /--watch(all)?\b/.test(cmd)
  )
}

function isDependencyMutationSegment(segment: string): boolean {
  const cmd = segment.trim().toLowerCase()
  return (
    /^(npm|pnpm|yarn|bun)\s+(install|i|add)\b/.test(cmd) ||
    /^(pip|pip3|poetry|uv)\s+(install|add)\b/.test(cmd) ||
    /^python(?:3)?\s+-m\s+pip\s+install\b/.test(cmd) ||
    /^(cargo\s+add|go\s+get)\b/.test(cmd)
  )
}

/** Replaces quoted strings to prevent false positives from literals. */
function stripQuotedSpans(command: string): string {
  return command.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''")
}

/** File redirection operator pattern. */
const FILE_REDIRECTION = /(?:^|[^0-9&>])>>?(?!&)/

/** Splits command chain into segments. */
function splitSegments(command: string): string[] {
  return command.split(/;|&&|\|\||\|/)
}

function firstToken(segment: string): string {
  const match = segment.trim().match(/^[^\s]+/)
  if (!match) return ''
  const basename = match[0].split(/[\\/]/).pop() || match[0]
  return basename.replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase()
}

function tokens(segment: string): string[] {
  return segment
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase())
}

/** Assesses if a command is a safe, falsifiable verification check. */
export function checkVerificationCommandSafety(rawCommand: string): VerificationCommandVerdict {
  if (!rawCommand || typeof rawCommand !== 'string' || !rawCommand.trim()) {
    return { isSafe: false, reason: 'the command is empty' }
  }

  const stripped = stripQuotedSpans(rawCommand.trim())

  if (FILE_REDIRECTION.test(stripped)) {
    return { isSafe: false, reason: 'it redirects output into a file, so it writes the workspace instead of checking it' }
  }

  for (const segment of splitSegments(stripped)) {
    if (!segment.trim()) continue
    const head = firstToken(segment)
    const parts = tokens(segment)

    if (MUTATING_COMMANDS.has(head)) {
      return { isSafe: false, reason: `\`${head}\` writes files, so it cannot also be the proof that they are correct` }
    }

    // Scaffolding subcommands
    if (parts.some((t) => t === 'init' || t === '--init')) {
      return { isSafe: false, reason: 'it is a scaffolding command (`init`), which generates the artefact instead of checking it' }
    }

    if (parts.some((t) => t === 'create' || t.startsWith('create-'))) {
      return { isSafe: false, reason: 'it scaffolds a project (`create`), which generates the artefact instead of checking it' }
    }

    if (isDependencyMutationSegment(segment)) {
      return { isSafe: false, reason: 'it changes dependencies; a successful install does not verify the deliverable' }
    }

    if ((head === 'sed' || head === 'perl') && parts.some((t) => t === '-i' || t.startsWith('-i.'))) {
      return { isSafe: false, reason: `\`${head} -i\` edits files in place, so it writes the workspace instead of checking it` }
    }

    if (VACUOUS_COMMANDS.has(head)) {
      return { isSafe: false, reason: `\`${head}\` exits 0 whatever the state of the code, so it can never fail and proves nothing` }
    }

    if (EXISTENCE_ONLY_COMMANDS.has(head)) {
      return {
        isSafe: false,
        reason: `\`${head}\` only prints what is already on disk, so it passes for any file that exists — including the one this milestone has just written — and says nothing about whether the code is correct`,
      }
    }

    if (INTERACTIVE_PROGRAMS.has(head)) {
      return {
        isSafe: false,
        reason: `\`${head}\` opens an interactive editor, pager or graphical window, which waits for a human and cannot report pass or fail in an unattended run`,
      }
    }

    if (isGuiModeVerificationSegment(segment)) {
      return {
        isSafe: false,
        reason:
          'it launches a test runner in graphical mode, which waits for a human and reports only whether the window was closed — use the headless subcommand (e.g. `cypress run`, `playwright test`) instead',
      }
    }

    if (isNonExitingVerificationSegment(segment)) {
      return {
        isSafe: false,
        reason: 'it starts a dev/watch server or other process that never exits on its own, so it can never run to completion and report pass or fail',
      }
    }
  }

  return { isSafe: true }
}

/** The note left on a milestone whose declared proof was refused. */
export function unsafeVerificationNote(command: string, reason: string): string {
  return `Declared verification \`${command}\` was refused: ${reason}. This milestone needs a real check before it can count as verified.`
}
