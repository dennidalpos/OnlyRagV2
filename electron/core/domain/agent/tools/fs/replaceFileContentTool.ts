import path from 'node:path'
import type { AgentToolCall } from '../../agentTypes'
import { validatePathSafety } from '../../contextFilter'
import { validateAST } from '../../fuzzyPatchEngine'
import { applyUniqueReplacements, compactMutationDiff, versionConflictFeedback } from '../../versionedFileMutation'
import type { SkillAdherenceViolation } from '../../../skills/skillAdherenceValidator'
import type { ToolExecutionResult } from '../toolExecutionContracts'

export interface ReplaceFileRepository {
  exists(absolutePath: string): boolean
  readIfExists(absolutePath: string): string
  writeFileVersioned(
    absolutePath: string,
    content: string,
    expectedContentHash: string,
    recordCommittedWrite: (originalContent: string | null) => void,
  ): { success: boolean; error?: string; currentContentHash?: string; currentContent?: string; conflict?: boolean }
}

export interface ReplaceFileJournal {
  recordOriginalState(filePath: string, originalContent: string | null): void
}

export async function executeReplaceFileContentTool(
  parameters: AgentToolCall['parameters'],
  workspacePath: string | null | undefined,
  activeSkillGuidelines: string,
  skillAdherence: (filePath: string, content: string, guidelines: string) => SkillAdherenceViolation | null,
  buildSkillRefusal: (filePath: string, violation: SkillAdherenceViolation) => string,
  repository: ReplaceFileRepository,
  journal: ReplaceFileJournal,
  buildChangeStats: (filePath: string, before: string, after: string) => { filePath: string; additions: number; deletions: number },
  contentVersion: (content: string) => string,
): Promise<ToolExecutionResult> {
  const filePath = parameters.filePath
  const targetContent = parameters.targetContent
  const replacementContent = parameters.replacementContent || ''
  const pathCheck = validatePathSafety(filePath, workspacePath)
  if (!pathCheck.safePath) {
    return { outcome: 'rejected', outputForHistory: `Security Violation: ${pathCheck.error}`, logMessage: `File Replace Rejected: ${pathCheck.error}` }
  }
  const safePath = pathCheck.safePath

  if (!filePath || !targetContent) {
    return { outcome: 'rejected', outputForHistory: `File not found or missing parameters for replacement: ${filePath || 'unknown'}`, logMessage: 'Missing replace parameters' }
  }
  if (!repository.exists(safePath)) {
    return { outcome: 'failure', outputForHistory: `Error: File not found for replacement: ${filePath}`, logMessage: `File not found: ${filePath}` }
  }

  const currentContent = repository.readIfExists(safePath)
  const actualHash = contentVersion(currentContent)
  if (parameters.expectedContentHash && parameters.expectedContentHash !== actualHash) {
    return {
      outcome: 'rejected',
      outputForHistory: versionConflictFeedback(String(filePath), parameters.expectedContentHash, actualHash),
      logMessage: `Replacement rejected: stale version for ${path.basename(filePath)}`,
    }
  }
  const replacement = applyUniqueReplacements(currentContent, [{ targetContent, replacementContent }])
  if (!replacement.success) {
    const failureFeedback = `[REPLACE FILE ERROR IN ${filePath}]\n${replacement.error}\nCurrent version: ${actualHash}\nRead the file again and generate a fresh exact edit. No content was written.`
    return { outcome: 'rejected', outputForHistory: failureFeedback, logMessage: `Replacement failed in ${path.basename(filePath)}: ${replacement.error}` }
  }

  const skillViolation = skillAdherence(String(filePath), replacementContent, activeSkillGuidelines)
  if (skillViolation) {
    return {
      outcome: 'rejected',
      outputForHistory: buildSkillRefusal(String(filePath), skillViolation),
      logMessage: `File Replace Rejected: violates active skill ${skillViolation.skillName}`,
    }
  }

  const astCheck = validateAST(safePath, replacement.content)
  if (!astCheck.isValid) {
    return {
      outcome: 'rejected',
      outputForHistory: `[PRE-COMMIT AST VALIDATION ERROR IN ${filePath}]\n${astCheck.syntaxError} (Line ${astCheck.line || '?'}:${astCheck.character || '?'})\nReplacement blocked before disk persistence to prevent syntax corruption.`,
      logMessage: `File Replace Rejected (AST Syntax Error): ${astCheck.syntaxError}`,
    }
  }

  const writeResult = repository.writeFileVersioned(
    safePath,
    replacement.content,
    actualHash,
    (originalContent) => journal.recordOriginalState(safePath, originalContent),
  )
  if (!writeResult.success) {
    if (writeResult.conflict) {
      return {
        outcome: 'rejected',
        outputForHistory: versionConflictFeedback(
          String(filePath),
          actualHash,
          writeResult.currentContentHash || 'missing',
          compactMutationDiff(writeResult.currentContent || '', replacement.content),
        ),
        logMessage: `Replacement rejected: concurrent change in ${path.basename(filePath)}`,
      }
    }
    return { outcome: 'failure', outputForHistory: `Error writing replaced content to ${filePath}: ${writeResult.error}`, logMessage: `Write error in ${path.basename(filePath)}` }
  }

  return {
    outcome: 'success',
    outputForHistory: `Successfully replaced content in ${filePath}`,
    logMessage: `Successfully replaced target chunk in ${path.basename(filePath)}`,
    changeStats: buildChangeStats(safePath, currentContent, replacement.content),
  }
}
