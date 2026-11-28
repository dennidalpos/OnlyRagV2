import type { ToolExecutionResult } from '../toolExecutionContracts'
import { toolLog } from '../toolExecutionContracts'

export interface GitCommitResult {
  success: boolean
  output: string
  logMessage: string
  localized?: ToolExecutionResult['localized']
}

export interface GitCommandError {
  message?: string
  stdout?: { toString(): string }
  stderr?: { toString(): string }
}

export type GitCommit = (cwd: string, message: string, paths: readonly string[], expectedDiffHash: string) => string

/** Runs git with an argument vector; model-supplied paths must never reach a shell. */
export type GitRun = (cwd: string, args: readonly string[], timeoutMs: number) => string

export type SafePathCheck = { safePath?: string | null; error?: string }

export function executeGitStatus(cwd: string, run: GitRun): import('../toolExecutionContracts').ToolExecutionResult {
  try {
    const stdout = run(cwd, ['status', '--short'], 10000)
    const outStr = stdout.trim()
      ? `[GIT STATUS: ${cwd}]\n${stdout.trim()}\n[END GIT STATUS]`
      : `[GIT STATUS: ${cwd}]\nWorking tree clean (no modified or untracked files).\n[END GIT STATUS]`
    return { outcome: 'success', outputForHistory: outStr, ...toolLog('toolGitStatusDone', { dir: cwd.split(/[\\/]/).pop() || cwd }) }
  } catch (error: unknown) {
    const message = (error as { message?: string })?.message || 'Unknown git error'
    return { outcome: 'failure', outputForHistory: `Git Status Error: ${message}`, ...toolLog('toolGitStatusError', { error: message }) }
  }
}

export function executeGitDiff(
  cwd: string,
  targetPath: string | undefined,
  staged: boolean,
  pathCheck: SafePathCheck | null,
  run: GitRun,
): ToolExecutionResult {
  if (targetPath && pathCheck && !pathCheck.safePath) {
    return {
      outcome: 'rejected',
      outputForHistory: `Security Violation: ${pathCheck.error}`,
      ...toolLog('toolEditPathRejected', { tool: 'git_diff', error: String(pathCheck.error) }),
    }
  }
  const pathArgs = pathCheck?.safePath ? ['--', pathCheck.safePath] : []
  const args = ['diff', ...(staged ? ['--staged'] : []), ...pathArgs]
  const label = staged ? 'staged' : 'unstaged'
  const render = (stdout: string, overflowed: boolean): ToolExecutionResult => {
    const trimmed = stdout.trim()
    const truncated = overflowed || trimmed.length > GIT_DIFF_HISTORY_CHARS
    // `git diff` never shows files git does not track yet, which are usually the ones the run created.
    const untracked = staged ? [] : untrackedFiles(cwd, pathArgs, run)
    const untrackedBlock = untracked.length
      ? `[UNTRACKED FILES: new, not in git yet, so the diff omits them; read_file shows their content]\n${untracked
          .slice(0, MAX_UNTRACKED_LISTED)
          .map((file) => `- ${file}`)
          .join('\n')}${untracked.length > MAX_UNTRACKED_LISTED ? `\n- ... ${untracked.length - MAX_UNTRACKED_LISTED} more` : ''}\n`
      : ''
    const outStr = trimmed
      ? `[GIT DIFF (${label}): ${targetPath || cwd}]\n\`\`\`diff\n${trimmed.slice(0, GIT_DIFF_HISTORY_CHARS)}\n\`\`\`\n${truncated ? '[DIFF TRUNCATED: pass filePath to inspect one file]\n' : ''}${untrackedBlock}[END GIT DIFF]`
      : `[GIT DIFF: ${targetPath || cwd}]\n${untracked.length ? 'No differences in tracked files.' : 'No differences detected.'}\n${untrackedBlock}[END GIT DIFF]`
    return {
      outcome: 'success',
      outputForHistory: outStr,
      ...toolLog('toolGitDiffDone', { target: targetPath ? targetPath.split(/[\\/]/).pop() || targetPath : 'workspace' }),
    }
  }
  try {
    return render(run(cwd, args, 15000), false)
  } catch (error: unknown) {
    // Only the first GIT_DIFF_HISTORY_CHARS reach the model, so a diff larger than the process
    // buffer is still an answer: keep what was read and say it was cut.
    const partial = bufferOverflowOutput(error)
    if (partial !== undefined) return render(partial, true)
    const message = (error as { message?: string })?.message || 'Unknown git error'
    return { outcome: 'failure', outputForHistory: `Git Diff Error: ${message}`, ...toolLog('toolGitDiffError', { error: message }) }
  }
}

const GIT_DIFF_HISTORY_CHARS = 8000
const MAX_UNTRACKED_LISTED = 50

/** Files git does not track yet (ignored ones excluded); empty when git cannot list them. */
function untrackedFiles(cwd: string, pathArgs: readonly string[], run: GitRun): string[] {
  try {
    return run(cwd, ['ls-files', '--others', '--exclude-standard', ...pathArgs], 15000)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function bufferOverflowOutput(error: unknown): string | undefined {
  const failure = error as { code?: string; stdout?: { toString(): string } | string }
  if (failure?.code !== 'ENOBUFS' || failure.stdout === undefined || failure.stdout === null) return undefined
  return failure.stdout.toString()
}

/** Validates and translates the git commit operation while delegating execution to infrastructure. */
export function performGitCommit(cwd: string, commitMessage: string, paths: readonly string[], expectedDiffHash: string, commit: GitCommit): GitCommitResult {
  const trimmedMessage = (commitMessage || '').trim()
  if (!trimmedMessage) {
    return {
      success: false,
      output: 'Git Commit Error: commitMessage parameter is required.',
      ...toolLog('toolGitCommitMissingMessage'),
    }
  }

  try {
    const stdout = commit(cwd, trimmedMessage, paths, expectedDiffHash)
    return {
      success: true,
      output: `[GIT COMMIT: ${cwd}]\n${stdout.trim()}\n[END GIT COMMIT]`,
      ...toolLog('toolGitCommitDone', { dir: cwd.split(/[\\/]/).pop() || cwd }),
    }
  } catch (error: unknown) {
    const commandError = error as GitCommandError
    const gitStdout = commandError.stdout?.toString().trim() || ''
    const gitStderr = commandError.stderr?.toString().trim() || ''
    const detail = [gitStdout, gitStderr].filter(Boolean).join('\n') || commandError.message || 'Unknown git error'
    return {
      success: false,
      output: `Git Commit Error: ${detail}`,
      ...toolLog('toolGitCommitError', { error: detail }),
    }
  }
}
