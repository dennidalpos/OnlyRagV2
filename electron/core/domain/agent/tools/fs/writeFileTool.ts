import path from 'node:path'
import type { AgentToolCall } from '../../agentTypes'
import { validatePathSafety } from '../../contextFilter'
import { classifyWriteFileTarget, rootConfigPathForMisplacedSourceFile } from '../../toolSchemaValidator'
import { detectRedundantWrite, buildRedundantWriteNotice } from '../../redundantWriteDetector'
import { validateAST } from '../../fuzzyPatchEngine'
import type { SkillAdherenceViolation } from '../../../skills/skillAdherenceValidator'
import type { ToolExecutionResult } from '../toolExecutionContracts'
import { compactMutationDiff, versionConflictFeedback } from '../../versionedFileMutation'

export interface WriteFileRepository {
  writeFileVersioned(
    absolutePath: string,
    content: string,
    expectedContentHash: string | undefined,
    beforeWrite: () => void,
  ): { success: boolean; error?: string; currentContentHash?: string }
}

export interface WriteFileSupportRepository {
  getFileInfo(absolutePath: string): unknown
  mkdir(absolutePath: string): void
}

export interface WriteFileJournal {
  recordBeforeModification(filePath: string): void
}

export interface WriteFileDependencies {
  repository: WriteFileRepository
  supportRepository: WriteFileSupportRepository
  journal: WriteFileJournal
  buildChangeStats: (filePath: string, before: string, after: string) => { filePath: string; additions: number; deletions: number }
  readContent: (absolutePath: string) => string
  importIntegrityDirective: (filePath: string | undefined, content: string, workspacePath: string | null | undefined) => string
  versionRealityDirective: (filePath: string | undefined, content: string) => Promise<string>
  incrementalTypecheck: (workspacePath: string, filePath: string) => string
  contentVersion: (content: string) => string
}

export async function executeWriteFileTool(
  parameters: AgentToolCall['parameters'],
  workspacePath: string | null | undefined,
  activeSkillGuidelines: string,
  skillAdherence: (filePath: string, content: string, guidelines: string) => SkillAdherenceViolation | null,
  buildSkillRefusal: (filePath: string, violation: SkillAdherenceViolation) => string,
  dependencies: WriteFileDependencies,
): Promise<ToolExecutionResult> {
  const filePath = parameters.filePath
  const content = parameters.content || ''
  const targetKind = classifyWriteFileTarget(filePath, content)

  if (targetKind === 'contradictory') {
    return {
      outcome: 'rejected',
      outputForHistory: `[WRITE_FILE REJECTED: PATH IS A DIRECTORY]\n"${filePath}" ends with a path separator, so it names a directory, but content was supplied for it.\nDirectives:\n1. To create the folder, call create_directory with dirPath "${filePath}".\n2. To write this content, call write_file again with the full file path, including the file name and extension.`,
      logMessage: `Write File Rejected: directory path with content ("${filePath}")`,
    }
  }

  if (targetKind === 'directory') {
    const dirPath = String(filePath)
    const dirCheck = validatePathSafety(dirPath, workspacePath)
    if (!dirCheck.safePath) {
      return { outcome: 'rejected', outputForHistory: `Security Violation: ${dirCheck.error}`, logMessage: `Create Directory Rejected: ${dirCheck.error}` }
    }
    try {
      dependencies.supportRepository.mkdir(dirCheck.safePath)
      return {
        outcome: 'success',
        outputForHistory: `Created DIRECTORY ${dirPath} (not a file: the path ends with a separator, so it was routed to create_directory). To add files inside it, call write_file with a full path such as "${dirPath.replace(/[\\/]+$/, '')}/example.ts".`,
        logMessage: `Created directory ${path.basename(dirCheck.safePath)} (write_file routed to create_directory)`,
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return { outcome: 'failure', outputForHistory: `Error creating directory ${dirPath}: ${message}`, logMessage: `Create directory error: ${message}` }
    }
  }

  const pathCheck = validatePathSafety(filePath, workspacePath)
  if (!pathCheck.safePath) {
    return { outcome: 'rejected', outputForHistory: `Security Violation: ${pathCheck.error}`, logMessage: `Write File Rejected: ${pathCheck.error}` }
  }
  const safePath = pathCheck.safePath

  const workspaceRelativePath = workspacePath ? path.relative(workspacePath, safePath) : String(filePath)
  const rootConfigPath = rootConfigPathForMisplacedSourceFile(workspaceRelativePath)
  if (rootConfigPath) {
    return {
      outcome: 'rejected',
      outputForHistory: `[ROOT CONFIG PATH REJECTED]\n"${workspaceRelativePath}" is a project configuration or entry file, so build tools will not discover it under src/.\nWrite the same complete content to "${rootConfigPath}" instead.`,
      logMessage: `Write File Rejected: root config targeted under src (${workspaceRelativePath})`,
    }
  }

  const skillViolation = skillAdherence(workspaceRelativePath, content, activeSkillGuidelines)
  if (skillViolation) {
    return {
      outcome: 'rejected',
      outputForHistory: buildSkillRefusal(workspaceRelativePath, skillViolation),
      logMessage: `Write File Rejected: violates active skill ${skillViolation.skillName}`,
    }
  }

  const astCheck = validateAST(safePath, content)
  if (!astCheck.isValid) {
    return {
      outcome: 'rejected',
      outputForHistory: `[PRE-COMMIT AST VALIDATION ERROR IN ${filePath}]\n${astCheck.syntaxError} (Line ${astCheck.line || '?'}:${astCheck.character || '?'})\nFile write blocked before disk persistence to prevent workspace corruption. Please fix syntax error.`,
      logMessage: `Write File Rejected (AST Syntax Error): ${astCheck.syntaxError}`,
    }
  }

  const beforeContent = dependencies.readContent(safePath)
  const exists = dependencies.supportRepository.getFileInfo(safePath) !== null
  const actualHash = dependencies.contentVersion(beforeContent)
  const redundant = detectRedundantWrite(exists, beforeContent, content)
  if (redundant.isRedundant && redundant.kind) {
    return {
      outcome: 'success',
      outputForHistory: buildRedundantWriteNotice(String(filePath), redundant.kind, redundant.isEmpty),
      logMessage: `No-op write: ${path.basename(safePath)} was already up to date`,
      noOpMutation: true,
    }
  }
  if (exists && parameters.expectedContentHash !== actualHash) {
    return {
      outcome: 'rejected',
      outputForHistory: versionConflictFeedback(
        String(filePath),
        parameters.expectedContentHash,
        actualHash,
        compactMutationDiff(beforeContent, content),
      ),
      logMessage: `Write File Rejected: stale or missing version for ${path.basename(safePath)}`,
    }
  }

  const result = dependencies.repository.writeFileVersioned(
    safePath,
    content,
    parameters.expectedContentHash,
    () => dependencies.journal.recordBeforeModification(safePath),
  )
  if (!result.success) {
    if (result.currentContentHash) {
      return {
        outcome: 'rejected',
        outputForHistory: versionConflictFeedback(String(filePath), parameters.expectedContentHash, result.currentContentHash),
        logMessage: `Write File Rejected: concurrent change in ${path.basename(safePath)}`,
      }
    }
    return { outcome: 'failure', outputForHistory: `Error writing file ${filePath}: ${result.error}`, logMessage: `Write file error: ${result.error}` }
  }

  const typecheckDiagnostic = workspacePath ? dependencies.incrementalTypecheck(workspacePath, safePath) || '' : ''
  return {
    outcome: 'success',
    outputForHistory: `Successfully wrote file ${filePath} (${exists ? 'updated existing file' : 'created new file'})${dependencies.importIntegrityDirective(filePath, content, workspacePath)}${await dependencies.versionRealityDirective(filePath, content)}${typecheckDiagnostic}`,
    logMessage: `${exists ? 'Updated existing file' : 'Created new file'} ${path.basename(safePath)}`,
    changeStats: dependencies.buildChangeStats(safePath, beforeContent, content),
  }
}
