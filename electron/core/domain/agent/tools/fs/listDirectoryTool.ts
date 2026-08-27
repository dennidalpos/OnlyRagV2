import type { AgentToolCall } from '../../agentTypes'
import { validatePathSafety } from '../../contextFilter'
import type { ToolExecutionResult } from '../toolExecutionContracts'

export interface ListDirectoryRepository {
  listDirEntries(absolutePath: string): { name: string; isDir: boolean }[] | null
}

export function executeListDirectoryTool(
  parameters: AgentToolCall['parameters'],
  workspacePath: string | null | undefined,
  repository: ListDirectoryRepository,
): ToolExecutionResult {
  const dirPath = parameters.dirPath || workspacePath || '.'
  const pathCheck = validatePathSafety(dirPath, workspacePath)
  if (!pathCheck.safePath) {
    return {
      outputForHistory: `Security Violation: ${pathCheck.error}`,
      logMessage: `List Dir Rejected: ${pathCheck.error}`,
    }
  }

  try {
    const entries = repository.listDirEntries(pathCheck.safePath)
    if (entries) {
      const output =
        `Listed directory [${dirPath}] (${entries.length} items):\n` +
        entries.map((entry) => `${entry.isDir ? '[DIR]' : '[FILE]'} ${entry.name}`).join('\n')
      return {
        outputForHistory: output,
        logMessage: `Directory Listing Result (${entries.length} items)`,
      }
    }
    return {
      outputForHistory: `Directory not found: ${dirPath}`,
      logMessage: `Directory not found: ${dirPath}`,
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      outputForHistory: `Error listing directory ${dirPath}: ${message}`,
      logMessage: `Error listing directory: ${message}`,
    }
  }
}
