import path from 'node:path'
import type { AgentToolCall } from '../domain/agent/agentTypes'
import { validatePathSafety } from '../domain/agent/contextFilter'
import type { ToolExecutionResult } from '../domain/agent/tools/toolExecutionContracts'
import { executeExtractCodeSymbolsTool } from '../domain/agent/tools/fs/extractCodeSymbolsTool'
import { executeFileInfoTool } from '../domain/agent/tools/fs/fileInfoTool'
import { executeListDirectoryTool } from '../domain/agent/tools/fs/listDirectoryTool'
import { executeListFilesRecursiveTool } from '../domain/agent/tools/fs/listFilesRecursiveTool'
import { executeReadFileTool } from '../domain/agent/tools/fs/readFileTool'
import { executeWriteFileTool, type WriteFileDependencies } from '../domain/agent/tools/fs/writeFileTool'
import { executeReplaceFileContentTool } from '../domain/agent/tools/fs/replaceFileContentTool'
import { executeMultiReplaceFileContentTool } from '../domain/agent/tools/fs/multiReplaceFileContentTool'
import type { SkillAdherenceViolation } from '../domain/skills/skillAdherenceValidator'
import { toolLog } from '../domain/agent/tools/toolExecutionContracts'

interface DeleteFileRepository {
  deleteFile(filePath: string): Promise<{ success: boolean; error?: string }>
}

interface CreateDirectoryRepository {
  mkdir(absolutePath: string): void
  copyFileRaw(sourcePath: string, targetPath: string): void
  renameRaw(sourcePath: string, targetPath: string): void
  listDirEntries(absolutePath: string): { name: string; isDir: boolean }[] | null
  getFileInfo(
    absolutePath: string,
  ): Parameters<typeof executeFileInfoTool>[2] extends infer R ? (R extends { getFileInfo: (...args: never[]) => infer T } ? T : never) : never
}

interface DeleteFileJournal {
  recordBeforeModification(filePath: string): void
  recordOriginalState(filePath: string, originalContent: string | null): void
}

interface DeleteFileDependencies {
  repository: DeleteFileRepository
  readRepository?: Parameters<typeof executeReadFileTool>[2]
  symbolsRepository?: Parameters<typeof executeExtractCodeSymbolsTool>[2]
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
  recursiveRepository?: Parameters<typeof executeListFilesRecursiveTool>[2]
  writeFileDependencies?: WriteFileDependencies
  replaceFile?: Parameters<typeof executeReplaceFileContentTool>[5]
  multiReplaceFile?: Parameters<typeof executeMultiReplaceFileContentTool>[5]
  skillAdherence?: (filePath: string, content: string, guidelines: string) => SkillAdherenceViolation | null
  buildSkillRefusal?: (filePath: string, violation: SkillAdherenceViolation) => string
  contentVersion?: (content: string) => string
  /** Incremental typecheck of a file an edit tool just wrote; empty when clean or not TypeScript. */
  checkWrittenFile?: (workspacePath: string, absolutePath: string) => string
}

/** Application service for filesystem tools extracted from the legacy executor. */
export class FsToolService {
  constructor(private readonly dependencies: DeleteFileDependencies) {}

  executeReadFile(parameters: AgentToolCall['parameters'], workspacePath: string | null | undefined): Promise<ToolExecutionResult> {
    return executeReadFileTool(parameters, workspacePath, this.dependencies.readRepository!, this.dependencies.directoryRepository)
  }

  executeExtractCodeSymbols(parameters: AgentToolCall['parameters'], workspacePath: string | null | undefined): Promise<ToolExecutionResult> {
    return executeExtractCodeSymbolsTool(parameters, workspacePath, this.dependencies.symbolsRepository!)
  }

  executeListDirectory(parameters: AgentToolCall['parameters'], workspacePath: string | null | undefined): ToolExecutionResult {
    return executeListDirectoryTool(parameters, workspacePath, this.dependencies.directoryRepository)
  }

  executeListFilesRecursive(parameters: AgentToolCall['parameters'], workspacePath: string | null | undefined): ToolExecutionResult {
    return executeListFilesRecursiveTool(parameters, workspacePath, this.dependencies.recursiveRepository!)
  }

  executeFileInfo(parameters: AgentToolCall['parameters'], workspacePath: string | null | undefined): ToolExecutionResult {
    return executeFileInfoTool(parameters, workspacePath, this.dependencies.directoryRepository)
  }

  async executeWriteFile(
    parameters: AgentToolCall['parameters'],
    workspacePath: string | null | undefined,
    allowFileModifications: boolean | undefined,
    activeSkillGuidelines: string,
  ): Promise<ToolExecutionResult> {
    if (allowFileModifications === false) {
      return { outcome: 'blocked', outputForHistory: 'Direct file write disabled in Settings.', ...toolLog('toolWriteDisabled') }
    }
    return executeWriteFileTool(
      parameters,
      workspacePath,
      activeSkillGuidelines,
      this.dependencies.skillAdherence!,
      this.dependencies.buildSkillRefusal!,
      this.dependencies.writeFileDependencies!,
    )
  }

  async executeReplaceFileContent(
    parameters: AgentToolCall['parameters'],
    workspacePath: string | null | undefined,
    allowFileModifications: boolean | undefined,
    activeSkillGuidelines: string,
  ): Promise<ToolExecutionResult> {
    if (allowFileModifications === false) {
      return { outcome: 'blocked', outputForHistory: 'Direct file modification disabled in Settings.', ...toolLog('toolModifyDisabled') }
    }
    return executeReplaceFileContentTool(
      parameters,
      workspacePath,
      activeSkillGuidelines,
      this.dependencies.skillAdherence!,
      this.dependencies.buildSkillRefusal!,
      this.dependencies.replaceFile!,
      this.dependencies.journal,
      this.dependencies.buildChangeStats,
      this.dependencies.contentVersion || ((content) => content),
      (absolutePath) => (workspacePath && this.dependencies.checkWrittenFile?.(workspacePath, absolutePath)) || '',
    )
  }

  async executeMultiReplaceFileContent(
    parameters: AgentToolCall['parameters'],
    workspacePath: string | null | undefined,
    allowFileModifications: boolean | undefined,
    activeSkillGuidelines: string,
  ): Promise<ToolExecutionResult> {
    if (allowFileModifications === false) {
      return { outcome: 'blocked', outputForHistory: 'Direct file modification disabled in Settings.', ...toolLog('toolModifyDisabled') }
    }
    return executeMultiReplaceFileContentTool(
      parameters,
      workspacePath,
      activeSkillGuidelines,
      this.dependencies.skillAdherence!,
      this.dependencies.buildSkillRefusal!,
      this.dependencies.multiReplaceFile!,
      this.dependencies.journal,
      this.dependencies.buildChangeStats,
      this.dependencies.contentVersion || ((content) => content),
      (absolutePath) => (workspacePath && this.dependencies.checkWrittenFile?.(workspacePath, absolutePath)) || '',
    )
  }

  async executeDeleteFile(
    parameters: AgentToolCall['parameters'],
    workspacePath: string | null | undefined,
    allowFileModifications: boolean | undefined,
  ): Promise<ToolExecutionResult> {
    if (allowFileModifications === false) {
      return { outcome: 'blocked', outputForHistory: 'Direct file deletion disabled in Settings.', ...toolLog('toolDeleteDisabled') }
    }

    const filePath = parameters.filePath
    const pathCheck = validatePathSafety(filePath, workspacePath)
    if (!pathCheck.safePath) {
      return {
        outcome: 'rejected',
        outputForHistory: `Security Violation: ${pathCheck.error}`,
        ...toolLog('toolEditPathRejected', { tool: 'delete_file', error: String(pathCheck.error) }),
      }
    }

    if (!filePath) {
      return { outcome: 'rejected', outputForHistory: 'Missing file path for deletion', ...toolLog('toolEditMissingParams', { tool: 'delete_file' }) }
    }

    const beforeContent = this.dependencies.readContent(pathCheck.safePath)
    this.dependencies.journal.recordBeforeModification(pathCheck.safePath)
    const result = await this.dependencies.repository.deleteFile(pathCheck.safePath)
    if (!result.success) {
      return {
        outcome: 'failure',
        outputForHistory: `Error deleting file ${filePath}: ${result.error}`,
        ...toolLog('toolActionError', { tool: 'delete_file', error: String(result.error) }),
      }
    }

    return {
      outcome: 'success',
      outputForHistory: `Successfully deleted file ${filePath}`,
      ...toolLog('toolDeleteDone', { file: path.basename(filePath) }),
      changeStats: this.dependencies.buildChangeStats(pathCheck.safePath, beforeContent, ''),
    }
  }

  executeCreateDirectory(
    parameters: AgentToolCall['parameters'],
    workspacePath: string | null | undefined,
    allowFileModifications: boolean | undefined,
  ): ToolExecutionResult {
    if (allowFileModifications === false) {
      return { outcome: 'blocked', outputForHistory: 'Directory creation disabled in Settings.', ...toolLog('toolDirectoryDisabled') }
    }

    const dirPath = parameters.dirPath || parameters.filePath
    const pathCheck = validatePathSafety(dirPath, workspacePath)
    if (!pathCheck.safePath) {
      return {
        outcome: 'rejected',
        outputForHistory: `Security Violation: ${pathCheck.error}`,
        ...toolLog('toolEditPathRejected', { tool: 'create_directory', error: String(pathCheck.error) }),
      }
    }

    try {
      this.dependencies.directoryRepository.mkdir(pathCheck.safePath)
      return {
        outcome: 'success',
        outputForHistory: `Successfully created directory ${dirPath}`,
        ...toolLog('toolDirectoryCreated', { dir: path.basename(pathCheck.safePath) }),
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        outcome: 'failure',
        outputForHistory: `Error creating directory ${dirPath}: ${message}`,
        ...toolLog('toolCreateDirectoryError', { error: message }),
      }
    }
  }

  executeCopyFile(
    parameters: AgentToolCall['parameters'],
    workspacePath: string | null | undefined,
    allowFileModifications: boolean | undefined,
  ): ToolExecutionResult {
    if (allowFileModifications === false) {
      return { outcome: 'blocked', outputForHistory: 'File copy disabled in Settings.', ...toolLog('toolCopyDisabled') }
    }

    const sourcePath = parameters.sourcePath || parameters.filePath
    const targetPath = parameters.targetPath || parameters.destination
    const sourceCheck = validatePathSafety(sourcePath, workspacePath)
    const targetCheck = validatePathSafety(targetPath, workspacePath)

    if (!sourceCheck.safePath || !targetCheck.safePath) {
      return {
        outcome: 'rejected',
        outputForHistory: `Security Violation: ${sourceCheck.error || targetCheck.error}`,
        ...toolLog('toolPathOutsideWorkspace', { tool: 'copy_file' }),
      }
    }

    try {
      this.dependencies.directoryRepository.mkdir(path.dirname(targetCheck.safePath))
      this.dependencies.journal.recordBeforeModification(targetCheck.safePath)
      this.dependencies.directoryRepository.copyFileRaw(sourceCheck.safePath, targetCheck.safePath)
      return {
        outcome: 'success',
        outputForHistory: `Successfully copied file from ${sourcePath} to ${targetPath}`,
        ...toolLog('toolCopyDone', { source: path.basename(sourceCheck.safePath), target: path.basename(targetCheck.safePath) }),
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        outcome: 'failure',
        outputForHistory: `Error copying file from ${sourcePath} to ${targetPath}: ${message}`,
        ...toolLog('toolActionError', { tool: 'copy_file', error: message }),
      }
    }
  }

  executeMoveFile(
    parameters: AgentToolCall['parameters'],
    workspacePath: string | null | undefined,
    allowFileModifications: boolean | undefined,
  ): ToolExecutionResult {
    if (allowFileModifications === false) {
      return { outcome: 'blocked', outputForHistory: 'File move/rename disabled in Settings.', ...toolLog('toolMoveDisabled') }
    }

    const sourcePath = parameters.sourcePath || parameters.filePath
    const targetPath = parameters.targetPath || parameters.destination
    const sourceCheck = validatePathSafety(sourcePath, workspacePath)
    const targetCheck = validatePathSafety(targetPath, workspacePath)

    if (!sourceCheck.safePath || !targetCheck.safePath) {
      return {
        outcome: 'rejected',
        outputForHistory: `Security Violation: ${sourceCheck.error || targetCheck.error}`,
        ...toolLog('toolPathOutsideWorkspace', { tool: 'move_file' }),
      }
    }

    try {
      this.dependencies.directoryRepository.mkdir(path.dirname(targetCheck.safePath))
      this.dependencies.journal.recordBeforeModification(sourceCheck.safePath)
      this.dependencies.journal.recordBeforeModification(targetCheck.safePath)
      this.dependencies.directoryRepository.renameRaw(sourceCheck.safePath, targetCheck.safePath)
      return {
        outcome: 'success',
        outputForHistory: `Successfully moved file from ${sourcePath} to ${targetPath}`,
        ...toolLog('toolMoveDone', { source: path.basename(sourceCheck.safePath), target: path.basename(targetCheck.safePath) }),
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        outcome: 'failure',
        outputForHistory: `Error moving file from ${sourcePath} to ${targetPath}: ${message}`,
        ...toolLog('toolActionError', { tool: 'move_file', error: message }),
      }
    }
  }

  async executeGrepSearch(parameters: AgentToolCall['parameters'], workspacePath: string | null | undefined): Promise<ToolExecutionResult> {
    const query = parameters.query || ''
    const targetDir = parameters.dirPath || workspacePath || '.'
    const isRegex = Boolean(parameters.isRegex)
    const caseInsensitive = parameters.caseInsensitive !== false
    const pathCheck = validatePathSafety(targetDir, workspacePath)

    if (!pathCheck.safePath) {
      return {
        outcome: 'rejected',
        outputForHistory: `Security Violation: ${pathCheck.error}`,
        ...toolLog('toolEditPathRejected', { tool: 'grep_search', error: String(pathCheck.error) }),
      }
    }

    try {
      const matches = await this.dependencies.searchRepository.grepSearch(pathCheck.safePath, query, isRegex, caseInsensitive)
      if (matches.length === 0) {
        return {
          outcome: 'success',
          outputForHistory: `Grep search for "${query}" in [${targetDir}] returned 0 matches.`,
          ...toolLog('toolGrepNone', { query: String(query) }),
        }
      }
      const displayedMatches = matches.slice(0, 50)
      const formattedMatches = displayedMatches.map((match) => `${match.relativePath}:${match.lineNumber}: ${match.lineContent}`).join('\n')
      return {
        outcome: 'success',
        outputForHistory: `Grep search for "${query}" in [${targetDir}] returned ${matches.length} matches (showing first ${displayedMatches.length}):\n${formattedMatches}`,
        ...toolLog('toolGrepFound', { count: matches.length, query: String(query) }),
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        outcome: 'failure',
        outputForHistory: `Error executing grep search for "${query}": ${message}`,
        ...toolLog('toolActionError', { tool: 'grep_search', error: message }),
      }
    }
  }
}
