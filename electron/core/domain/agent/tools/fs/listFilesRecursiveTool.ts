import type { AgentToolCall } from '../../agentTypes'
import { validatePathSafety } from '../../contextFilter'
import type { ToolExecutionResult } from '../toolExecutionContracts'

const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', '.venv', 'build', '.next', 'out', 'coverage', '.pytest_cache'])

export interface RecursiveListingRepository {
  exists(absolutePath: string): boolean
  listRecursive(rootPath: string, maxDepth: number, ignoreDirs: Set<string>): string[]
}

export function executeListFilesRecursiveTool(
  parameters: AgentToolCall['parameters'],
  workspacePath: string | null | undefined,
  repository: RecursiveListingRepository,
): ToolExecutionResult {
  const dirPath = parameters.dirPath || workspacePath || '.'
  const maxDepth = Math.max(1, Math.min(6, parameters.maxDepth || 3))
  const pathCheck = validatePathSafety(dirPath, workspacePath)
  if (!pathCheck.safePath) {
    return {
      outputForHistory: `Security Violation: ${pathCheck.error}`,
      logMessage: `List Files Recursive Rejected: ${pathCheck.error}`,
    }
  }

  try {
    if (!repository.exists(pathCheck.safePath)) {
      return {
        outputForHistory: `Directory not found: ${dirPath}`,
        logMessage: `Directory not found: ${dirPath}`,
      }
    }

    const discovered = repository.listRecursive(pathCheck.safePath, maxDepth, IGNORED_DIRECTORIES)
    const output = `Recursive Directory Structure for [${dirPath}] (depth <= ${maxDepth}, ${discovered.length} items):\n${discovered.slice(0, 150).join('\n')}`
    return {
      outputForHistory: output,
      logMessage: `Recursive List: ${discovered.length} items in ${dirPath}`,
      logDetail: output.slice(0, 800),
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      outputForHistory: `Error listing files recursively: ${message}`,
      logMessage: `Recursive list error: ${message}`,
    }
  }
}
