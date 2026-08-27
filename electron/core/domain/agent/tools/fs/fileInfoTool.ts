import path from 'node:path'
import type { AgentToolCall } from '../../agentTypes'
import { validatePathSafety } from '../../contextFilter'
import type { ToolExecutionResult } from '../toolExecutionContracts'

export interface FileInfoRepository {
  getFileInfo(absolutePath: string): {
    isDirectory: boolean
    sizeBytes: number
    isBinary: boolean
    lineCount: number
    mtimeIso: string
  } | null
}

export function executeFileInfoTool(
  parameters: AgentToolCall['parameters'],
  workspacePath: string | null | undefined,
  repository: FileInfoRepository,
): ToolExecutionResult {
  const targetPath = parameters.filePath
  const pathCheck = validatePathSafety(targetPath, workspacePath)
  if (!pathCheck.safePath) {
    return {
      outputForHistory: `Security Violation: ${pathCheck.error}`,
      logMessage: `Get File Info Rejected: ${pathCheck.error}`,
    }
  }

  try {
    const info = repository.getFileInfo(pathCheck.safePath)
    if (!info) {
      return {
        outputForHistory: `[FILE INFO: ${targetPath}]\nStatus: Does Not Exist\n[END FILE INFO]`,
        logMessage: `File Info: File not found: ${targetPath}`,
      }
    }

    const infoStr = `[FILE INFO: ${targetPath}]\n` +
      `Type: ${info.isDirectory ? 'Directory' : 'File'}\n` +
      `Size: ${info.sizeBytes} bytes (${(info.sizeBytes / 1024).toFixed(2)} KB)\n` +
      `Is Binary: ${info.isBinary}\n` +
      `Line Count: ${info.lineCount}\n` +
      `Last Modified: ${info.mtimeIso}\n` +
      `[END FILE INFO]`

    return {
      outputForHistory: infoStr,
      logMessage: `File Info retrieved for ${path.basename(pathCheck.safePath)}`,
    }
  } catch (error: unknown) {
    const message = (error as { message?: string })?.message || 'Unknown file info error'
    return {
      outputForHistory: `Get File Info Error: ${message}`,
      logMessage: `File Info Error: ${message}`,
    }
  }
}
