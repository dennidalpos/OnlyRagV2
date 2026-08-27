import path from 'node:path'
import type { AgentToolCall } from '../../agentTypes'
import { validatePathSafety } from '../../contextFilter'
import { applyFuzzyReplace, validateAST } from '../../fuzzyPatchEngine'
import type { SkillAdherenceViolation } from '../../../skills/skillAdherenceValidator'
import type { ToolExecutionResult } from '../toolExecutionContracts'

export interface ReplaceFileRepository {
  exists(absolutePath: string): boolean
  readIfExists(absolutePath: string): string
  writeFile(absolutePath: string, content: string): Promise<{ success: boolean; error?: string }>
}

export interface ReplaceFileJournal {
  recordBeforeModification(filePath: string): void
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
): Promise<ToolExecutionResult> {
  const filePath = parameters.filePath
  const targetContent = parameters.targetContent
  const replacementContent = parameters.replacementContent || ''
  const pathCheck = validatePathSafety(filePath, workspacePath)
  if (!pathCheck.safePath) {
    return { outputForHistory: `Security Violation: ${pathCheck.error}`, logMessage: `File Replace Rejected: ${pathCheck.error}` }
  }

  if (!filePath || !targetContent) {
    return { outputForHistory: `File not found or missing parameters for replacement: ${filePath || 'unknown'}`, logMessage: 'Missing replace parameters' }
  }
  if (!repository.exists(pathCheck.safePath)) {
    return { outputForHistory: `Error: File not found for replacement: ${filePath}`, logMessage: `File not found: ${filePath}` }
  }

  const currentContent = repository.readIfExists(pathCheck.safePath)
  const fuzzyResult = applyFuzzyReplace(currentContent, targetContent, replacementContent)
  if (!fuzzyResult.success || fuzzyResult.updatedContent === undefined) {
    const failureFeedback = `[REPLACE FILE ERROR IN ${filePath}]\n${fuzzyResult.error || 'Target chunk not found.'}\nTip: Inspect the file with read_file or check exact whitespace before replacing.`
    return { outputForHistory: failureFeedback, logMessage: `Replacement failed in ${path.basename(filePath)}: ${fuzzyResult.error}` }
  }

  const skillViolation = skillAdherence(String(filePath), replacementContent, activeSkillGuidelines)
  if (skillViolation) {
    return {
      outputForHistory: buildSkillRefusal(String(filePath), skillViolation),
      logMessage: `File Replace Rejected: violates active skill ${skillViolation.skillName}`,
    }
  }

  const astCheck = validateAST(pathCheck.safePath, fuzzyResult.updatedContent)
  if (!astCheck.isValid) {
    return {
      outputForHistory: `[PRE-COMMIT AST VALIDATION ERROR IN ${filePath}]\n${astCheck.syntaxError} (Line ${astCheck.line || '?'}:${astCheck.character || '?'})\nReplacement blocked before disk persistence to prevent syntax corruption.`,
      logMessage: `File Replace Rejected (AST Syntax Error): ${astCheck.syntaxError}`,
    }
  }

  journal.recordBeforeModification(pathCheck.safePath)
  const writeResult = await repository.writeFile(pathCheck.safePath, fuzzyResult.updatedContent)
  if (!writeResult.success) {
    return { outputForHistory: `Error writing replaced content to ${filePath}: ${writeResult.error}`, logMessage: `Write error in ${path.basename(filePath)}` }
  }

  const confidenceNote = fuzzyResult.confidenceScore < 1.0 ? ` (Fuzzy Match Confidence: ${(fuzzyResult.confidenceScore * 100).toFixed(1)}%)` : ''
  return {
    outputForHistory: `Successfully replaced content in ${filePath}${confidenceNote}`,
    logMessage: `Successfully replaced target chunk in ${path.basename(filePath)}${confidenceNote}`,
    changeStats: buildChangeStats(pathCheck.safePath, currentContent, fuzzyResult.updatedContent),
  }
}
