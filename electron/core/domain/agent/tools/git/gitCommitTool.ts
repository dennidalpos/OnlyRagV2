import type { ToolExecutionResult } from '../toolExecutionContracts'

export interface GitCommitResult {
  success: boolean
  output: string
  logMessage: string
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
    return { outcome: 'success', outputForHistory: outStr, logMessage: `Git Status checked in ${cwd.split(/[\\/]/).pop() || cwd}` }
  } catch (error: unknown) {
    const message = (error as { message?: string })?.message || 'Unknown git error'
    return { outcome: 'failure', outputForHistory: `Git Status Error: ${message}`, logMessage: `Git Status Error: ${message}` }
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
    return { outcome: 'rejected', outputForHistory: `Security Violation: ${pathCheck.error}`, logMessage: `Git Diff Rejected: ${pathCheck.error}` }
  }
  const args = ['diff', ...(staged ? ['--staged'] : []), ...(pathCheck?.safePath ? ['--', pathCheck.safePath] : [])]
  const label = staged ? 'staged' : 'unstaged'
  const render = (stdout: string, overflowed: boolean): ToolExecutionResult => {
    const trimmed = stdout.trim()
    const truncated = overflowed || trimmed.length > GIT_DIFF_HISTORY_CHARS
    const outStr = trimmed
      ? `[GIT DIFF (${label}): ${targetPath || cwd}]\n\`\`\`diff\n${trimmed.slice(0, GIT_DIFF_HISTORY_CHARS)}\n\`\`\`\n${truncated ? '[DIFF TRUNCATED: pass filePath to inspect one file]\n' : ''}[END GIT DIFF]`
      : `[GIT DIFF: ${targetPath || cwd}]\nNo differences detected.\n[END GIT DIFF]`
    return { outcome: 'success', outputForHistory: outStr, logMessage: `Git Diff completed for ${targetPath ? targetPath.split(/[\\/]/).pop() : 'workspace'}` }
  }
  try {
    return render(run(cwd, args, 15000), false)
  } catch (error: unknown) {
    // Only the first GIT_DIFF_HISTORY_CHARS reach the model, so a diff larger than the process
    // buffer is still an answer: keep what was read and say it was cut.
    const partial = bufferOverflowOutput(error)
    if (partial !== undefined) return render(partial, true)
    const message = (error as { message?: string })?.message || 'Unknown git error'
    return { outcome: 'failure', outputForHistory: `Git Diff Error: ${message}`, logMessage: `Git Diff Error: ${message}` }
  }
}

const GIT_DIFF_HISTORY_CHARS = 8000

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
      logMessage: 'Git Commit Error: missing commit message',
    }
  }

  try {
    const stdout = commit(cwd, trimmedMessage, paths, expectedDiffHash)
    return {
      success: true,
      output: `[GIT COMMIT: ${cwd}]\n${stdout.trim()}\n[END GIT COMMIT]`,
      logMessage: `Git Commit created in ${cwd.split(/[\\/]/).pop() || cwd}`,
    }
  } catch (error: unknown) {
    const commandError = error as GitCommandError
    const gitStdout = commandError.stdout?.toString().trim() || ''
    const gitStderr = commandError.stderr?.toString().trim() || ''
    const detail = [gitStdout, gitStderr].filter(Boolean).join('\n') || commandError.message || 'Unknown git error'
    return {
      success: false,
      output: `Git Commit Error: ${detail}`,
      logMessage: `Git Commit Error: ${detail}`,
    }
  }
}
