/**
 * Verification Command Safety.
 *
 * A milestone's `verificationCommand` is executed for real by `update_plan`, and a zero exit
 * code promotes the milestone to `verified`. That makes the command a claim about the code —
 * so it must be capable of failing, and it must not be the thing that produces the artefact
 * it is supposed to judge.
 *
 * Neither held. In coding_agent_audit.log session-1787497654743-4enx the planner emitted
 * `touch src/App.tsx` and `echo "import React..." > src/pages/Tasks.tsx` as verification for
 * ten of fifteen milestones. Both ran. `touch` is translated to `New-Item -Force`, which
 * truncates an existing file; the `echo` redirection rewrote the agent's own source as
 * UTF-16LE with the `\n` escapes left literal. `src/App.tsx` and `src/pages/Tasks.tsx` ended
 * the session as invalid TypeScript, and the log recorded "Verification command passed" for
 * the very command that had just destroyed them.
 *
 * The planning prompt already forbids inventing commands (see buildVerificationCommandsBlock).
 * A 7B model disobeyed it, which is the normal case rather than the exceptional one, so the
 * contract is enforced here in code instead of being asked for in prose.
 *
 * Two rejection families, both fatal to the promise a verification makes:
 *  - MUTATING: the command writes to the workspace. It cannot be trusted to judge the file it
 *    just wrote, and in the observed session it actively corrupted source.
 *  - VACUOUS: the command exits 0 whatever the state of the code (`echo`, `true`, `cd`). It
 *    can never fail, so promoting on its exit code is the same rubber stamp the
 *    verificationCommand mechanism exists to remove.
 *
 * Build and test commands stay allowed even though they write to `dist/` or `coverage/`:
 * their exit code reflects the code under test, which is the property that matters. The
 * denylist targets commands whose *only* effect is to author a named file.
 */

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
 * Replaces the contents of quoted spans so the operator scan cannot trip over punctuation
 * that belongs to a string literal — `echo "<div className=...>"` carries a `>` that is not
 * a redirection, and JSX in an `echo` payload is exactly the case that produced the bug.
 */
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

    if ((head === 'sed' || head === 'perl') && parts.some((t) => t === '-i' || t.startsWith('-i.'))) {
      return { isSafe: false, reason: `\`${head} -i\` edits files in place, so it writes the workspace instead of checking it` }
    }

    if (VACUOUS_COMMANDS.has(head)) {
      return { isSafe: false, reason: `\`${head}\` exits 0 whatever the state of the code, so it can never fail and proves nothing` }
    }
  }

  return { isSafe: true }
}

/** The note left on a milestone whose declared proof was refused. */
export function unsafeVerificationNote(command: string, reason: string): string {
  return `Declared verification \`${command}\` was refused: ${reason}. This milestone needs a real check before it can count as verified.`
}
