import path from 'node:path'
import type { AgentToolCall } from '../../agentTypes'
import { validatePathSafety } from '../../contextFilter'
import type { SkillAdherenceViolation } from '../../../skills/skillAdherenceValidator'
import type { ToolExecutionResult } from '../toolExecutionContracts'

export interface MultiReplaceFileRepository {
  readIfExists(absolutePath: string): string
  multiReplaceChunks(
    absolutePath: string,
    replacements: Array<{ targetContent: string; replacementContent: string }>,
  ): Promise<{ success: boolean; replacedCount: number; error?: string }>
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
): Promise<ToolExecutionResult> {
  const filePath = parameters.filePath
  const replacements = (parameters.replacements || []) as Array<{ targetContent: string; replacementContent: string }>
  const pathCheck = validatePathSafety(filePath, workspacePath)
  if (!pathCheck.safePath) {
    return { outputForHistory: `Security Violation: ${pathCheck.error}`, logMessage: `Multi Replace Rejected: ${pathCheck.error}` }
  }

  if (!filePath || replacements.length === 0) {
    return { outputForHistory: `Missing parameters or empty chunks for multi-replace: ${filePath || 'unknown'}`, logMessage: 'Missing multi-replace parameters' }
  }

  const skillViolation = skillAdherence(
    String(filePath),
    replacements.map((replacement) => replacement.replacementContent).join('\n'),
    activeSkillGuidelines,
  )
  if (skillViolation) {
    return {
      outputForHistory: buildSkillRefusal(String(filePath), skillViolation),
      logMessage: `Multi Replace Rejected: violates active skill ${skillViolation.skillName}`,
    }
  }

  const beforeContent = repository.readIfExists(pathCheck.safePath)
  journal.recordBeforeModification(pathCheck.safePath)
  const result = await repository.multiReplaceChunks(pathCheck.safePath, replacements)
  if (result.success) {
    const afterContent = repository.readIfExists(pathCheck.safePath)
    return {
      outputForHistory: `Successfully replaced ${result.replacedCount} chunks in ${filePath}`,
      logMessage: `Successfully applied ${result.replacedCount} replacements in ${path.basename(filePath)}`,
      changeStats: buildChangeStats(pathCheck.safePath, beforeContent, afterContent),
    }
  }

  const failureFeedback = `[REPLACE FILE ERROR IN ${filePath}]\n${result.error}\nTip: Inspect the file with read_file or check exact whitespace before replacing.`
  return { outputForHistory: failureFeedback, logMessage: `Multi-replace failed in ${path.basename(filePath)}: ${result.error}` }
}
