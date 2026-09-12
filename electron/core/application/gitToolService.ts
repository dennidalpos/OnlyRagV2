import type { AgentToolCall } from '../domain/agent/agentTypes'
import { validatePathSafety } from '../domain/agent/contextFilter'
import { executeGitDiff, executeGitStatus, performGitCommit, type GitCommitResult, type GitRun } from '../domain/agent/tools/git/gitCommitTool'
import type { GitCommitPreview } from '../infrastructure/process/gitCliRepository'
import type { ToolExecutionResult } from '../domain/agent/tools/toolExecutionContracts'

interface GitToolDependencies {
  run: GitRun
  previewCommit(cwd: string, paths: readonly string[]): GitCommitPreview
  commit(cwd: string, message: string, paths: readonly string[], expectedDiffHash: string): string
  markCommitBoundary(): void
}

/** Application service for Git tool operations. */
export class GitToolService {
  constructor(private readonly dependencies: GitToolDependencies) {}

  executeStatus(workspacePath: string | null | undefined): ToolExecutionResult {
    return executeGitStatus(workspacePath || process.cwd(), this.dependencies.run)
  }

  executeDiff(parameters: AgentToolCall['parameters'], workspacePath: string | null | undefined): ToolExecutionResult {
    const cwd = workspacePath || process.cwd()
    const targetPath = parameters.filePath
    const pathCheck = targetPath ? validatePathSafety(targetPath, workspacePath) : null
    return executeGitDiff(cwd, targetPath, Boolean(parameters.staged), pathCheck, this.dependencies.run)
  }

  executeCommit(parameters: AgentToolCall['parameters'], workspacePath: string | null | undefined): ToolExecutionResult {
    const paths = Array.isArray(parameters.commitPaths) ? parameters.commitPaths.filter((value): value is string => typeof value === 'string') : []
    const result = this.commit(workspacePath || process.cwd(), parameters.commitMessage || '', paths, String(parameters.commitDiffHash || ''))
    return { outcome: result.success ? 'success' : 'failure', outputForHistory: result.output, logMessage: result.logMessage }
  }

  previewCommit(cwd: string, paths: readonly string[]): GitCommitPreview {
    return this.dependencies.previewCommit(cwd, paths)
  }

  commit(cwd: string, commitMessage: string, paths: readonly string[], expectedDiffHash: string): GitCommitResult {
    const result = performGitCommit(cwd, commitMessage, paths, expectedDiffHash, this.dependencies.commit)
    if (result.success) this.dependencies.markCommitBoundary()
    return result
  }
}
