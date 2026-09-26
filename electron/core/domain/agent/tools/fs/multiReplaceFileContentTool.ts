import path from 'node:path'
import type { AgentToolCall } from '../../agentTypes'
import { validatePathSafety } from '../../contextFilter'
import type { SkillAdherenceViolation } from '../../../skills/skillAdherenceValidator'
import type { ToolExecutionResult } from '../toolExecutionContracts'
import { validateAST } from '../../fuzzyPatchEngine'
import { applyUniqueReplacements, compactMutationDiff, versionConflictFeedback } from '../../versionedFileMutation'
import { toolLog } from '../toolExecutionContracts'

export interface MultiReplaceFileRepository {
  readIfExists(absolutePath: string): string
  writeFileVersioned(
    absolutePath: string,
    content: string,
    expectedContentHash: string,
    recordCommittedWrite: (originalContent: string | null) => void,
  ): { success: boolean; error?: string; currentContentHash?: string; currentContent?: string; conflict?: boolean }
}

export interface MultiReplaceFileJournal {
  recordOriginalState(filePath: string, originalContent: string | null): void
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
  /** Diagnostics for the file just written (the incremental typecheck), appended to the result. */
  checkWrittenFile: (absolutePath: string) => Promise<string> = async () => '',
): Promise<ToolExecutionResult> {
  const filePath = parameters.filePath
  const replacements = (parameters.replacements || []) as Array<{ targetContent: string; replacementContent: string }>
  const pathCheck = validatePathSafety(filePath, workspacePath)
  if (!pathCheck.safePath) {
    return {
      outcome: 'rejected',
      outputForHistory: `Security Violation: ${pathCheck.error}`,
      ...toolLog('toolEditPathRejected', { tool: 'multi_replace_file_content', error: String(pathCheck.error) }),
    }
  }
  const safePath = pathCheck.safePath

  if (!filePath || replacements.length === 0) {
    return {
      outcome: 'rejected',
      outputForHistory: `Missing parameters or empty chunks for multi-replace: ${filePath || 'unknown'}`,
      ...toolLog('toolEditMissingParams', { tool: 'multi_replace_file_content' }),
    }
  }

  const skillViolation = skillAdherence(String(filePath), replacements.map((replacement) => replacement.replacementContent).join('\n'), activeSkillGuidelines)
  if (skillViolation) {
    return {
      outcome: 'rejected',
      outputForHistory: buildSkillRefusal(String(filePath), skillViolation),
      ...toolLog('toolEditSkillViolation', { tool: 'multi_replace_file_content', skill: skillViolation.skillName }),
    }
  }

  const beforeContent = repository.readIfExists(safePath)
  const actualHash = contentVersion(beforeContent)
  if (parameters.expectedContentHash && parameters.expectedContentHash !== actualHash) {
    return {
      outcome: 'rejected',
      outputForHistory: versionConflictFeedback(String(filePath), parameters.expectedContentHash, actualHash),
      ...toolLog('toolEditStaleVersion', { tool: 'multi_replace_file_content', file: path.basename(filePath) }),
    }
  }
  const prepared = applyUniqueReplacements(beforeContent, replacements)
  if (!prepared.success) {
    return {
      outcome: 'rejected',
      outputForHistory: `[REPLACE FILE ERROR IN ${filePath}]\n${prepared.error}\nCurrent version: ${actualHash}\nRead the file again and regenerate the complete replacement set. No content was written.`,
      ...toolLog('toolEditFailed', { tool: 'multi_replace_file_content', file: path.basename(filePath), error: String(prepared.error) }),
    }
  }

  const astCheck = validateAST(safePath, prepared.content)
  if (!astCheck.isValid) {
    return {
      outcome: 'rejected',
      outputForHistory: `[PRE-COMMIT AST VALIDATION ERROR IN ${filePath}]\n${astCheck.syntaxError} (Line ${astCheck.line || '?'}:${astCheck.character || '?'})\nMulti-replace blocked before disk persistence to prevent syntax corruption.`,
      ...toolLog('toolEditSyntaxError', { tool: 'multi_replace_file_content', error: String(astCheck.syntaxError) }),
    }
  }

  const result = repository.writeFileVersioned(safePath, prepared.content, actualHash, (originalContent) =>
    journal.recordOriginalState(safePath, originalContent),
  )
  if (result.success)
    return {
      outcome: 'success',
      outputForHistory: `Successfully replaced ${prepared.replacedCount} chunks in ${filePath}\nApplied change:\n${compactMutationDiff(beforeContent, prepared.content)}${workspacePath ? await checkWrittenFile(safePath) : ''}`,
      ...toolLog('toolMultiReplaceDone', { count: prepared.replacedCount, file: path.basename(filePath) }),
      changeStats: buildChangeStats(safePath, beforeContent, prepared.content),
    }

  if (result.conflict)
    return {
      outcome: 'rejected',
      outputForHistory: versionConflictFeedback(
        String(filePath),
        actualHash,
        result.currentContentHash || 'missing',
        compactMutationDiff(result.currentContent || '', prepared.content),
      ),
      ...toolLog('toolEditConcurrentChange', { tool: 'multi_replace_file_content', file: path.basename(filePath) }),
    }

  const failureFeedback = `[REPLACE FILE ERROR IN ${filePath}]\n${result.error}\nNo partial replacement was written.`
  return {
    outcome: 'failure',
    outputForHistory: failureFeedback,
    ...toolLog('toolEditFailed', { tool: 'multi_replace_file_content', file: path.basename(filePath), error: String(result.error) }),
  }
}
