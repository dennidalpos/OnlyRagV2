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

export type GitCommit = (cwd: string, message: string) => string

export type GitRun = (cwd: string, command: string, timeoutMs: number) => string

export type SafePathCheck = { safePath?: string | null; error?: string }

export function executeGitStatus(cwd: string, run: GitRun): import('../toolExecutionContracts').ToolExecutionResult {
  try {
    const stdout = run(cwd, 'status --short', 10000)
    const outStr = stdout.trim()
      ? `[GIT STATUS: ${cwd}]\n${stdout.trim()}\n[END GIT STATUS]`
      : `[GIT STATUS: ${cwd}]\nWorking tree clean (no modified or untracked files).\n[END GIT STATUS]`
    return { outputForHistory: outStr, logMessage: `Git Status checked in ${cwd.split(/[\\/]/).pop() || cwd}` }
  } catch (error: unknown) {
    const message = (error as { message?: string })?.message || 'Unknown git error'
    return { outputForHistory: `Git Status Error: ${message}`, logMessage: `Git Status Error: ${message}` }
  }
}

export function executeGitDiff(
  cwd: string,
  targetPath: string | undefined,
  staged: boolean,
  pathCheck: SafePathCheck | null,
  run: GitRun,
): import('../toolExecutionContracts').ToolExecutionResult {
  if (targetPath && pathCheck && !pathCheck.safePath) {
    return { outputForHistory: `Security Violation: ${pathCheck.error}`, logMessage: `Git Diff Rejected: ${pathCheck.error}` }
  }
  try {
    const fileArg = pathCheck?.safePath ? ` -- "${pathCheck.safePath}"` : ''
    const stagedFlag = staged ? ' --staged' : ''
    const stdout = run(cwd, `diff${stagedFlag}${fileArg}`, 15000)
    const truncated = stdout.trim().slice(0, 8000)
    const outStr = stdout.trim()
      ? `[GIT DIFF (${staged ? 'staged' : 'unstaged'}): ${targetPath || cwd}]\n\`\`\`diff\n${truncated}\n\`\`\`\n[END GIT DIFF]`
      : `[GIT DIFF: ${targetPath || cwd}]\nNo differences detected.\n[END GIT DIFF]`
    return { outputForHistory: outStr, logMessage: `Git Diff completed for ${targetPath ? targetPath.split(/[\\/]/).pop() : 'workspace'}` }
  } catch (error: unknown) {
    const message = (error as { message?: string })?.message || 'Unknown git error'
    return { outputForHistory: `Git Diff Error: ${message}`, logMessage: `Git Diff Error: ${message}` }
  }
}

/** Validates and translates the git commit operation while delegating execution to infrastructure. */
export function performGitCommit(cwd: string, commitMessage: string, commit: GitCommit): GitCommitResult {
  const trimmedMessage = (commitMessage || '').trim()
  if (!trimmedMessage) {
    return {
      success: false,
      output: 'Git Commit Error: commitMessage parameter is required.',
      logMessage: 'Git Commit Error: missing commit message',
    }
  }

  try {
    const stdout = commit(cwd, trimmedMessage)
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
