import type { AgentToolCall } from '../domain/agent/agentTypes'
import { validatePathSafety } from '../domain/agent/contextFilter'
import { executeGitDiff, executeGitStatus, performGitCommit, type GitCommitResult, type GitRun } from '../domain/agent/tools/git/gitCommitTool'
import type { ToolExecutionResult } from '../domain/agent/tools/toolExecutionContracts'

interface GitToolDependencies {
  run: GitRun
  commit(cwd: string, message: string): string
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
    const result = this.commit(workspacePath || process.cwd(), parameters.commitMessage || '')
    return { outputForHistory: result.output, logMessage: result.logMessage }
  }

  commit(cwd: string, commitMessage: string): GitCommitResult {
    return performGitCommit(cwd, commitMessage, this.dependencies.commit)
  }
}
