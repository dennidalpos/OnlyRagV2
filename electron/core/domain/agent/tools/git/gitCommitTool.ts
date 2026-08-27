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
