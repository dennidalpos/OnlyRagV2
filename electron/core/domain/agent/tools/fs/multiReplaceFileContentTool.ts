import path from 'node:path'
import type { AgentToolCall } from '../../agentTypes'
import { validatePathSafety } from '../../contextFilter'
import type { SkillAdherenceViolation } from '../../../skills/skillAdherenceValidator'
import type { ToolExecutionResult } from '../toolExecutionContracts'
import { applyUniqueReplacements, versionConflictFeedback } from '../../versionedFileMutation'

export interface MultiReplaceFileRepository {
  readIfExists(absolutePath: string): string
  writeFileVersioned(
    absolutePath: string,
    content: string,
    expectedContentHash: string,
    beforeWrite: () => void,
  ): { success: boolean; error?: string; currentContentHash?: string }
}

export interface MultiReplaceFileJournal {
  recordBeforeModification(filePath: string): void
}

export async function executeMultiReplaceFileContentTool(
  parameters: AgentToolCall['parameters'],
  workspacePath: string | null | undefined,
  activeSkillGuidelines: string,
  skillAdherence: (filePath: string, content: string, guidelines: string) => SkillAdherenceViolation | null,
  buildSkillRefusal: (filePath: string, violation: SkillAdherenceViolation) => string,
  repository: MultiReplaceFileRepository,
  journal: MultiReplaceFileJournal,
  buildChangeStats: (filePath: string, before: string, after: string) => { filePath: string; additions: number; deletions: number },
  contentVersion: (content: string) => string,
): Promise<ToolExecutionResult> {
  const filePath = parameters.filePath
  const replacements = (parameters.replacements || []) as Array<{ targetContent: string; replacementContent: string }>
  const pathCheck = validatePathSafety(filePath, workspacePath)
  if (!pathCheck.safePath) {
    return { outcome: 'rejected', outputForHistory: `Security Violation: ${pathCheck.error}`, logMessage: `Multi Replace Rejected: ${pathCheck.error}` }
  }
  const safePath = pathCheck.safePath

  if (!filePath || replacements.length === 0) {
    return { outcome: 'rejected', outputForHistory: `Missing parameters or empty chunks for multi-replace: ${filePath || 'unknown'}`, logMessage: 'Missing multi-replace parameters' }
  }

  const skillViolation = skillAdherence(
    String(filePath),
    replacements.map((replacement) => replacement.replacementContent).join('\n'),
    activeSkillGuidelines,
  )
  if (skillViolation) {
    return {
      outcome: 'rejected',
      outputForHistory: buildSkillRefusal(String(filePath), skillViolation),
      logMessage: `Multi Replace Rejected: violates active skill ${skillViolation.skillName}`,
    }
  }

  const beforeContent = repository.readIfExists(safePath)
  const actualHash = contentVersion(beforeContent)
  if (parameters.expectedContentHash && parameters.expectedContentHash !== actualHash) {
    return {
      outcome: 'rejected',
      outputForHistory: versionConflictFeedback(String(filePath), parameters.expectedContentHash, actualHash),
      logMessage: `Multi-replace rejected: stale version for ${path.basename(filePath)}`,
    }
  }
  const prepared = applyUniqueReplacements(beforeContent, replacements)
  if (!prepared.success) {
    return {
      outcome: 'rejected',
      outputForHistory: `[REPLACE FILE ERROR IN ${filePath}]\n${prepared.error}\nCurrent version: ${actualHash}\nRead the file again and regenerate the complete replacement set. No content was written.`,
      logMessage: `Multi-replace failed in ${path.basename(filePath)}: ${prepared.error}`,
    }
  }

  const result = repository.writeFileVersioned(
    safePath,
    prepared.content,
    actualHash,
    () => journal.recordBeforeModification(safePath),
  )
  if (result.success) return {
    outcome: 'success',
    outputForHistory: `Successfully replaced ${prepared.replacedCount} chunks in ${filePath}`,
    logMessage: `Successfully applied ${prepared.replacedCount} replacements in ${path.basename(filePath)}`,
    changeStats: buildChangeStats(safePath, beforeContent, prepared.content),
  }

  if (result.currentContentHash) return {
    outcome: 'rejected',
    outputForHistory: versionConflictFeedback(String(filePath), actualHash, result.currentContentHash),
    logMessage: `Multi-replace rejected: concurrent change in ${path.basename(filePath)}`,
  }

  const failureFeedback = `[REPLACE FILE ERROR IN ${filePath}]\n${result.error}\nNo partial replacement was written.`
  return { outcome: 'failure', outputForHistory: failureFeedback, logMessage: `Multi-replace failed in ${path.basename(filePath)}: ${result.error}` }
}
