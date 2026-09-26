import path from 'node:path'
import type { AgentToolCall } from '../../agentTypes'
import { validatePathSafety } from '../../contextFilter'
import type { ToolExecutionResult } from '../toolExecutionContracts'
import { toolLog } from '../toolExecutionContracts'

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
      outcome: 'rejected',
      outputForHistory: `Security Violation: ${pathCheck.error}`,
      ...toolLog('toolEditPathRejected', { tool: 'get_file_info', error: String(pathCheck.error) }),
    }
  }

  try {
    const info = repository.getFileInfo(pathCheck.safePath)
    if (!info) {
      return {
        outcome: 'success',
        outputForHistory: `[FILE INFO: ${targetPath}]\nStatus: Does Not Exist\n[END FILE INFO]`,
        ...toolLog('toolFileNotFound', { path: String(targetPath) }),
      }
    }

    const infoStr =
      `[FILE INFO: ${targetPath}]\n` +
      `Type: ${info.isDirectory ? 'Directory' : 'File'}\n` +
      `Size: ${info.sizeBytes} bytes (${(info.sizeBytes / 1024).toFixed(2)} KB)\n` +
      `Is Binary: ${info.isBinary}\n` +
      `Line Count: ${info.lineCount}\n` +
      `Last Modified: ${info.mtimeIso}\n` +
      `[END FILE INFO]`

    return {
      outcome: 'success',
      outputForHistory: infoStr,
      ...toolLog('toolFileInfoDone', { file: path.basename(pathCheck.safePath) }),
    }
  } catch (error: unknown) {
    const message = (error as { message?: string })?.message || 'Unknown file info error'
    return {
      outcome: 'failure',
      outputForHistory: `Get File Info Error: ${message}`,
      ...toolLog('toolFileInfoError', { error: message }),
    }
  }
}
