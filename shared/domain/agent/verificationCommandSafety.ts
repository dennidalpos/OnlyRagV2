/** Rejects commands that cannot provide falsifiable, non-mutating milestone evidence. */

export interface VerificationCommandVerdict {
  /** True when the command may be executed as proof of a milestone. */
  isSafe: boolean
  /** Why it was refused, phrased for the plan note and the audit log. Absent when safe. */
  reason?: string
}

/** Commands whose whole purpose is to create or overwrite a named file. */
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
const VACUOUS_COMMANDS = new Set([
  'echo',
  'true',
  ':',
  'cd',
  'exit',
  'set-location',
  'write-host',
  'write-output',
])

/**
 * Commands that print a file or list a directory: they exit 0 for anything that exists,
 * whatever it contains.
 *
 * Not vacuous in the strict sense — `cat missing.txt` does fail — but the only thing they can
 * fail on is absence, and the file whose absence they would report is the one the agent has
 * just written. The exit code therefore carries no information about the code at all.
 *
 * This was the dominant verification in coding_agent_audit.log session-1787562597025-q8a5:
 * seven of fifteen milestones declared `cat <file>` as their proof. Milestone m-2 promised
 * `vite.config.ts` AND `tsconfig.json`, passed on `cat vite.config.ts`, and was recorded as the
 * single verified milestone of the session — while `tsconfig.json` was never created and the
 * project's own `tsc && vite build` could not run at all.
 *
 * Content searches are deliberately absent from this list: `grep`, `findstr` and
 * `Select-String` fail when the file exists but does not say what it should, which is a real
 * claim about the code and a legitimate proof.
 */
const EXISTENCE_ONLY_COMMANDS = new Set([
  'cat',
  'type',
  'get-content',
  'gc',
  'head',
  'tail',
  'ls',
  'dir',
  'get-childitem',
  'gci',
  'test-path',
  'stat',
])

/**
 * Terminal editors and pagers. Every one of these waits for a keypress or a TTY that
 * run_command cannot supply, so none of them can report pass or fail — they either hang until
 * the timeout or exit on a signal that says nothing about the file's content.
 */
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
  // Openers and editors that hand the workspace to a graphical application and return an exit
  // code describing the launch, never the code.
  'start',
  'open',
  'xdg-open',
  'explorer',
  'code',
  'code-insiders',
  'storybook',
  'start-storybook',
])

/**
 * Test runners invoked in their graphical mode.
 *
 * The binary is a legitimate verification tool — `npx cypress run` and `npx playwright test`
 * are exactly the falsifiable proof a milestone wants — but `open`, `--ui` and `--headed`
 * switch it into a window that waits for a human and reports only whether that window was
 * closed. The distinction is the subcommand, so it cannot be made by the first token alone.
 *
 * session-1787562597025-q8a5 carried `npx cypress open` as the declared proof for four
 * milestones (validating the interface at 375, 768, 1024 and 1440 px). Cypress was not even a
 * dependency of the project: those four were unverifiable from the moment the plan was parsed.
 */
function isGuiModeVerificationSegment(segment: string): boolean {
  const cmd = segment.trim().toLowerCase()
  if (!cmd) return false
  return (
    /\b(cypress|playwright|vitest|jest|nightwatch)\s+(open|--ui|--headed)\b/.test(cmd) ||
    /\b(cypress|playwright|vitest|jest|nightwatch)\b.*\s--(ui|headed)\b/.test(cmd)
  )
}

/**
 * Mirrors isBlockingDevServerSubcommand in agentToolExecutorService.ts. Domain code must not
 * import the application layer (see loopDetector.ts's SHELL_TOOL_KEYWORDS for the same
 * constraint handled the same way), so the patterns are kept here in sync by hand. Both copies
 * exist to catch the same commands at two different times: this one keeps them out of the plan
 * before the model ever tries them, the other refuses to execute one if it slips through anyway.
 */
function isNonExitingVerificationSegment(segment: string): boolean {
  const cmd = segment.trim().toLowerCase()
  if (!cmd) return false

  // Install commands are never dev servers, even when the package name is "vite" or "next".
  if (/^(npm|pnpm|yarn|bun)\s+(install|i|add)\b/.test(cmd)) return false

  // Pure build/test/lint/typecheck commands exit on their own and stay allowed.
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

/** Replaces contents of quoted spans to prevent false positives from string literals (e.g. JSX tag `>`). */
function stripQuotedSpans(command: string): string {
  return command.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''")
}

/**
 * Output redirection to a file. `2>&1` and `>&2` are handle redirections, not writes, so a
 * digit or `&` before the operator and an `&` after it are both excluded.
 */
const FILE_REDIRECTION = /(?:^|[^0-9&>])>>?(?!&)/

/** Splits a command chain into its segments so `npm test; touch x` is judged on both halves. */
function splitSegments(command: string): string[] {
  return command.split(/;|&&|\|\||\|/)
}

function firstToken(segment: string): string {
  const match = segment.trim().match(/^[^\s]+/)
  if (!match) return ''
  // A command may be spelled as a path (`./node_modules/.bin/tsc`, `C:\tools\touch.exe`);
  // the basename is what identifies it.
  const basename = match[0].split(/[\\/]/).pop() || match[0]
  return basename.replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase()
}

function tokens(segment: string): string[] {
  return segment.trim().split(/\s+/).filter(Boolean).map((t) => t.toLowerCase())
}

/**
 * Decides whether a command may stand as proof that a milestone is done.
 *
 * Pure and workspace-independent by design: it runs both when a plan is parsed and again
 * immediately before execution, and the second call has to hold for plans restored from a
 * previous session or edited by hand in the UI.
 */
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

    // `npm init`, `npx tailwindcss init -p`, `git init`, `tsc --init`: scaffolding subcommands
    // that generate the artefact rather than inspect it.
    if (parts.some((t) => t === 'init' || t === '--init')) {
      return { isSafe: false, reason: 'it is a scaffolding command (`init`), which generates the artefact instead of checking it' }
    }

    // `npm create vite`, `npx create-react-app .`
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
        reason: 'it launches a test runner in graphical mode, which waits for a human and reports only whether the window was closed — use the headless subcommand (e.g. `cypress run`, `playwright test`) instead',
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
