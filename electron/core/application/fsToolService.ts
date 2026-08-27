import path from 'node:path'
import type { AgentToolCall } from '../domain/agent/agentTypes'
import { validatePathSafety } from '../domain/agent/contextFilter'
import type { ToolExecutionResult } from '../domain/agent/tools/toolExecutionContracts'

interface DeleteFileRepository {
  deleteFile(filePath: string): Promise<{ success: boolean; error?: string }>
}

interface CreateDirectoryRepository {
  mkdir(absolutePath: string): void
  copyFileRaw(sourcePath: string, targetPath: string): void
  renameRaw(sourcePath: string, targetPath: string): void
}

interface DeleteFileJournal {
  recordBeforeModification(filePath: string): void
}

interface DeleteFileDependencies {
  repository: DeleteFileRepository
  searchRepository: {
    grepSearch(
      dirPath: string,
      query: string,
      isRegex?: boolean,
      caseInsensitive?: boolean,
    ): Promise<{ relativePath: string; lineNumber: number; lineContent: string }[]>
  }
  directoryRepository: CreateDirectoryRepository
  journal: DeleteFileJournal
  readContent: (filePath: string) => string
  buildChangeStats: (filePath: string, before: string, after: string) => { filePath: string; additions: number; deletions: number }
}

/** Application service for filesystem tools extracted from the legacy executor. */
export class FsToolService {
  constructor(private readonly dependencies: DeleteFileDependencies) {}

  async executeDeleteFile(
    parameters: AgentToolCall['parameters'],
    workspacePath: string | null | undefined,
    allowFileModifications: boolean | undefined,
  ): Promise<ToolExecutionResult> {
    if (allowFileModifications === false) {
      return { outputForHistory: 'Direct file deletion disabled in Settings.', logMessage: 'File deletion disabled in settings' }
    }

    const filePath = parameters.filePath
    const pathCheck = validatePathSafety(filePath, workspacePath)
    if (!pathCheck.safePath) {
      return { outputForHistory: `Security Violation: ${pathCheck.error}`, logMessage: `Delete File Rejected: ${pathCheck.error}` }
    }

    if (!filePath) {
      return { outputForHistory: 'Missing file path for deletion', logMessage: 'Missing delete parameter' }
    }

    const beforeContent = this.dependencies.readContent(pathCheck.safePath)
    this.dependencies.journal.recordBeforeModification(pathCheck.safePath)
    const result = await this.dependencies.repository.deleteFile(pathCheck.safePath)
    if (!result.success) {
      return { outputForHistory: `Error deleting file ${filePath}: ${result.error}`, logMessage: `Error deleting file: ${result.error}` }
    }

    return {
      outputForHistory: `Successfully deleted file ${filePath}`,
      logMessage: `Successfully deleted file ${path.basename(filePath)}`,
      changeStats: this.dependencies.buildChangeStats(pathCheck.safePath, beforeContent, ''),
    }
  }

  executeCreateDirectory(
    parameters: AgentToolCall['parameters'],
    workspacePath: string | null | undefined,
    allowFileModifications: boolean | undefined,
  ): ToolExecutionResult {
    if (allowFileModifications === false) {
      return { outputForHistory: 'Directory creation disabled in Settings.', logMessage: 'Directory creation disabled in settings' }
    }

    const dirPath = parameters.dirPath || parameters.filePath
    const pathCheck = validatePathSafety(dirPath, workspacePath)
    if (!pathCheck.safePath) {
      return { outputForHistory: `Security Violation: ${pathCheck.error}`, logMessage: `Create Directory Rejected: ${pathCheck.error}` }
    }

    try {
      this.dependencies.directoryRepository.mkdir(pathCheck.safePath)
      return {
        outputForHistory: `Successfully created directory ${dirPath}`,
        logMessage: `Successfully created directory ${path.basename(pathCheck.safePath)}`,
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return { outputForHistory: `Error creating directory ${dirPath}: ${message}`, logMessage: `Create directory error: ${message}` }
    }
  }

  executeCopyFile(
    parameters: AgentToolCall['parameters'],
    workspacePath: string | null | undefined,
    allowFileModifications: boolean | undefined,
  ): ToolExecutionResult {
    if (allowFileModifications === false) {
      return { outputForHistory: 'File copy disabled in Settings.', logMessage: 'File copy disabled in settings' }
    }

    const sourcePath = parameters.sourcePath || parameters.filePath
    const targetPath = parameters.targetPath || parameters.destination
    const sourceCheck = validatePathSafety(sourcePath, workspacePath)
    const targetCheck = validatePathSafety(targetPath, workspacePath)

    if (!sourceCheck.safePath || !targetCheck.safePath) {
      return {
        outputForHistory: `Security Violation: ${sourceCheck.error || targetCheck.error}`,
        logMessage: 'Copy File Rejected: Security Violation',
      }
    }

    try {
      this.dependencies.directoryRepository.mkdir(path.dirname(targetCheck.safePath))
      this.dependencies.journal.recordBeforeModification(targetCheck.safePath)
      this.dependencies.directoryRepository.copyFileRaw(sourceCheck.safePath, targetCheck.safePath)
      return {
        outputForHistory: `Successfully copied file from ${sourcePath} to ${targetPath}`,
        logMessage: `Successfully copied ${path.basename(sourceCheck.safePath)} -> ${path.basename(targetCheck.safePath)}`,
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        outputForHistory: `Error copying file from ${sourcePath} to ${targetPath}: ${message}`,
        logMessage: `Copy file error: ${message}`,
      }
    }
  }

  executeMoveFile(
    parameters: AgentToolCall['parameters'],
    workspacePath: string | null | undefined,
    allowFileModifications: boolean | undefined,
  ): ToolExecutionResult {
    if (allowFileModifications === false) {
      return { outputForHistory: 'File move/rename disabled in Settings.', logMessage: 'File move disabled in settings' }
    }

    const sourcePath = parameters.sourcePath || parameters.filePath
    const targetPath = parameters.targetPath || parameters.destination
    const sourceCheck = validatePathSafety(sourcePath, workspacePath)
    const targetCheck = validatePathSafety(targetPath, workspacePath)

    if (!sourceCheck.safePath || !targetCheck.safePath) {
      return {
        outputForHistory: `Security Violation: ${sourceCheck.error || targetCheck.error}`,
        logMessage: 'Move File Rejected: Security Violation',
      }
    }

    try {
      this.dependencies.directoryRepository.mkdir(path.dirname(targetCheck.safePath))
      this.dependencies.journal.recordBeforeModification(sourceCheck.safePath)
      this.dependencies.journal.recordBeforeModification(targetCheck.safePath)
      this.dependencies.directoryRepository.renameRaw(sourceCheck.safePath, targetCheck.safePath)
      return {
        outputForHistory: `Successfully moved file from ${sourcePath} to ${targetPath}`,
        logMessage: `Successfully moved ${path.basename(sourceCheck.safePath)} -> ${path.basename(targetCheck.safePath)}`,
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        outputForHistory: `Error moving file from ${sourcePath} to ${targetPath}: ${message}`,
        logMessage: `Move file error: ${message}`,
      }
    }
  }

  async executeGrepSearch(
    parameters: AgentToolCall['parameters'],
    workspacePath: string | null | undefined,
  ): Promise<ToolExecutionResult> {
    const query = parameters.query || ''
    const targetDir = parameters.dirPath || workspacePath || '.'
    const isRegex = Boolean(parameters.isRegex)
    const caseInsensitive = parameters.caseInsensitive !== false
    const pathCheck = validatePathSafety(targetDir, workspacePath)

    if (!pathCheck.safePath) {
      return {
        outputForHistory: `Security Violation: ${pathCheck.error}`,
        logMessage: `Grep Search Rejected: ${pathCheck.error}`,
      }
    }

    try {
      const matches = await this.dependencies.searchRepository.grepSearch(pathCheck.safePath, query, isRegex, caseInsensitive)
      if (matches.length === 0) {
        return {
          outputForHistory: `Grep search for "${query}" in [${targetDir}] returned 0 matches.`,
          logMessage: `Grep Search: 0 matches for "${query}"`,
        }
      }
      const displayedMatches = matches.slice(0, 50)
      const formattedMatches = displayedMatches
        .map((match) => `${match.relativePath}:${match.lineNumber}: ${match.lineContent}`)
        .join('\n')
      return {
        outputForHistory: `Grep search for "${query}" in [${targetDir}] returned ${matches.length} matches (showing first ${displayedMatches.length}):\n${formattedMatches}`,
        logMessage: `Grep Search: ${matches.length} matches for "${query}"`,
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        outputForHistory: `Error executing grep search for "${query}": ${message}`,
        logMessage: `Grep Search Error: ${message}`,
      }
    }
  }
}
