import type { AgentToolCall } from '../../agentTypes'
import { validatePathSafety } from '../../contextFilter'
import type { ToolExecutionResult } from '../toolExecutionContracts'
import { toolLog } from '../toolExecutionContracts'

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
      outcome: 'rejected',
      outputForHistory: `Security Violation: ${pathCheck.error}`,
      ...toolLog('toolEditPathRejected', { tool: 'list_dir', error: String(pathCheck.error) }),
    }
  }

  try {
    const entries = repository.listDirEntries(pathCheck.safePath)
    if (entries) {
      const output =
        `Listed directory [${dirPath}] (${entries.length} items):\n` + entries.map((entry) => `${entry.isDir ? '[DIR]' : '[FILE]'} ${entry.name}`).join('\n')
      return {
        outcome: 'success',
        outputForHistory: output,
        ...toolLog('toolListDirDone', { count: entries.length }),
      }
    }
    return {
      outcome: 'failure',
      outputForHistory: `Directory not found: ${dirPath}`,
      ...toolLog('toolDirNotFound', { path: String(dirPath) }),
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      outcome: 'failure',
      outputForHistory: `Error listing directory ${dirPath}: ${message}`,
      ...toolLog('toolListDirError', { error: message }),
    }
  }
}
