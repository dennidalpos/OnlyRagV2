import path from 'node:path'
import type { AgentToolCall } from '../../agentTypes'
import { validatePathSafety } from '../../contextFilter'
import { validateAST } from '../../fuzzyPatchEngine'
import { applyUniqueReplacements, compactMutationDiff, versionConflictFeedback } from '../../versionedFileMutation'
import type { SkillAdherenceViolation } from '../../../skills/skillAdherenceValidator'
import type { ToolExecutionResult } from '../toolExecutionContracts'
import { toolLog } from '../toolExecutionContracts'

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
  /** Diagnostics for the file just written (the incremental typecheck), appended to the result. */
  checkWrittenFile: (absolutePath: string) => string = () => '',
): Promise<ToolExecutionResult> {
  const filePath = parameters.filePath
  const targetContent = parameters.targetContent
  const replacementContent = parameters.replacementContent || ''
  const pathCheck = validatePathSafety(filePath, workspacePath)
  if (!pathCheck.safePath) {
    return {
      outcome: 'rejected',
      outputForHistory: `Security Violation: ${pathCheck.error}`,
      ...toolLog('toolEditPathRejected', { tool: 'replace_file_content', error: String(pathCheck.error) }),
    }
  }
  const safePath = pathCheck.safePath

  if (!filePath || !targetContent) {
    return {
      outcome: 'rejected',
      outputForHistory: `File not found or missing parameters for replacement: ${filePath || 'unknown'}`,
      ...toolLog('toolEditMissingParams', { tool: 'replace_file_content' }),
    }
  }
  if (!repository.exists(safePath)) {
    return {
      outcome: 'failure',
      outputForHistory: `Error: File not found for replacement: ${filePath}`,
      ...toolLog('toolFileNotFound', { path: String(filePath) }),
    }
  }

  const currentContent = repository.readIfExists(safePath)
  const actualHash = contentVersion(currentContent)
  if (parameters.expectedContentHash && parameters.expectedContentHash !== actualHash) {
    return {
      outcome: 'rejected',
      outputForHistory: versionConflictFeedback(String(filePath), parameters.expectedContentHash, actualHash),
      ...toolLog('toolEditStaleVersion', { tool: 'replace_file_content', file: path.basename(filePath) }),
    }
  }
  const replacement = applyUniqueReplacements(currentContent, [{ targetContent, replacementContent }])
  if (!replacement.success) {
    const failureFeedback = `[REPLACE FILE ERROR IN ${filePath}]\n${replacement.error}\nCurrent version: ${actualHash}\nRead the file again and generate a fresh exact edit. No content was written.`
    return {
      outcome: 'rejected',
      outputForHistory: failureFeedback,
      ...toolLog('toolEditFailed', { tool: 'replace_file_content', file: path.basename(filePath), error: String(replacement.error) }),
    }
  }

  const skillViolation = skillAdherence(String(filePath), replacementContent, activeSkillGuidelines)
  if (skillViolation) {
    return {
      outcome: 'rejected',
      outputForHistory: buildSkillRefusal(String(filePath), skillViolation),
      ...toolLog('toolEditSkillViolation', { tool: 'replace_file_content', skill: skillViolation.skillName }),
    }
  }

  const astCheck = validateAST(safePath, replacement.content)
  if (!astCheck.isValid) {
    return {
      outcome: 'rejected',
      outputForHistory: `[PRE-COMMIT AST VALIDATION ERROR IN ${filePath}]\n${astCheck.syntaxError} (Line ${astCheck.line || '?'}:${astCheck.character || '?'})\nReplacement blocked before disk persistence to prevent syntax corruption.`,
      ...toolLog('toolEditSyntaxError', { tool: 'replace_file_content', error: String(astCheck.syntaxError) }),
    }
  }

  const writeResult = repository.writeFileVersioned(safePath, replacement.content, actualHash, (originalContent) =>
    journal.recordOriginalState(safePath, originalContent),
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
        ...toolLog('toolEditConcurrentChange', { tool: 'replace_file_content', file: path.basename(filePath) }),
      }
    }
    return {
      outcome: 'failure',
      outputForHistory: `Error writing replaced content to ${filePath}: ${writeResult.error}`,
      ...toolLog('toolEditFailed', { tool: 'replace_file_content', file: path.basename(filePath), error: String(writeResult.error || 'write error') }),
    }
  }

  return {
    outcome: 'success',
    outputForHistory: `Successfully replaced content in ${filePath}\nApplied change:\n${compactMutationDiff(currentContent, replacement.content)}${workspacePath ? checkWrittenFile(safePath) : ''}`,
    ...toolLog('toolReplaceDone', { file: path.basename(filePath) }),
    changeStats: buildChangeStats(safePath, currentContent, replacement.content),
  }
}
