import { PromptCompiler } from '../../../../shared/domain/agent/promptCompiler'
import type { OllamaRuntimeOptions } from './hardwareProfileResolver'
import type { AppSettings } from '../../../../shared/types'
import type { ActiveFileContext } from './agentTypes'
import type { AgentMode } from './agentTypes'

export interface PromptAssemblerInput {
  userTask: string
  initialUserTask?: string
  agentMode: AgentMode
  stepCount: number
  maxSteps: number
  workspacePath?: string | null
  isStandaloneMode?: boolean
  activeFile?: ActiveFileContext | null
  pinnedFilesContextStr?: string
  skillsBlock?: string
  planBlock?: string
  attachedContext?: string
  projectContextMapStr?: string
  settings: AppSettings
  runtimeOpts: OllamaRuntimeOptions
}

export interface AssembledPrompt {
  /** Per-turn step counter, appended to this turn's context message. */
  turnSuffix: string
  /** Disjoint pieces: the frozen system message is built from some, the turn context from the others. */
  segments: {
    baseSystemPrompt: string
    planSection: string
    pinnedBlock: string
    activeFileBlock: string
    skillsSection: string
    attachedBlock: string
    mapBlock: string
  }
}

/**
 * Assembles the prompt segments of one native chat turn. The tool catalogue travels as the request's
 * `tools` array and the history as chat messages, so neither appears here.
 */
export function assembleTurnPrompt(input: PromptAssemblerInput): AssembledPrompt {
  const {
    userTask,
    initialUserTask,
    agentMode,
    stepCount,
    maxSteps,
    workspacePath,
    isStandaloneMode,
    activeFile,
    pinnedFilesContextStr,
    skillsBlock,
    planBlock,
    attachedContext,
    projectContextMapStr,
    settings,
    runtimeOpts,
  } = input

  // Format combined user task if initial task exists and differs from turn prompt
  const effectiveTaskText =
    initialUserTask && initialUserTask.trim() !== userTask.trim()
      ? `PRIMARY OVERALL GOAL / PROJECT SPECIFICATION:\n"""\n${initialUserTask.trim()}\n"""\n\nCURRENT TURN INSTRUCTION / FOLLOW-UP ANSWER:\n"""\n${userTask.trim()}\n"""`
      : userTask.trim()

  const now = new Date()
  const formattedDate = now.toLocaleDateString('it-IT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const currentDate = `${now.toISOString().split('T')[0]} (${formattedDate})`

  // Priority 1: Base System Prompt & User Goal Guidelines (Mandatory intact).
  const { prompt: baseSystemPrompt } = PromptCompiler.compileCodingPrompt(
    {
      agentMode: agentMode.toUpperCase(),
      userTask: effectiveTaskText,
      workspacePath: isStandaloneMode ? 'Standalone (No Workspace)' : workspacePath || 'No Folder Selected',
      currentDate,
    },
    settings,
  )

  // Priority 1.5: Dynamic Execution Plan & Goal Decomposition
  const planSection = planBlock ? `${planBlock}\n` : ''

  // Priority 2: Active File Snippet & Explicitly Pinned Workspace Code Files
  const activeFileBlock = activeFile
    ? `Active File Open in Editor: ${activeFile.name} (${activeFile.path})\n[EDITOR VERSION: ${activeFile.versionHash}]\nSnippet:\n${activeFile.content.slice(0, 8000)}\n`
    : ''
  const pinnedBlock = pinnedFilesContextStr ? `EXPLICITLY REFERENCED (PINNED) WORKSPACE FILES:\n${pinnedFilesContextStr.slice(0, 16000)}\n` : ''

  // Priority 2.5: Contextual Domain Skills & Guidelines
  const skillsSection = skillsBlock ? `${skillsBlock}\n` : ''

  // Priority 3: Auxiliary Background Context (RAG docs & Repository Tree Map).
  const maxRAGChars = Math.floor(runtimeOpts.maxContextChars * 0.12)
  const maxMapChars = Math.floor(runtimeOpts.maxContextChars * 0.18)
  const attachedBlock = attachedContext ? `ATTACHED RAG DOCS CONTEXT:\n${attachedContext.slice(0, maxRAGChars)}\n` : ''
  const mapBlock = projectContextMapStr ? `FULL REPOSITORY WORKSPACE MAP (${workspacePath}):\n${projectContextMapStr.slice(0, maxMapChars)}\n` : ''

  const maxStepsLabel = maxSteps === Infinity || maxSteps === 0 ? '∞' : String(maxSteps)
  const turnSuffix = `CURRENT TURN STATUS: Step ${stepCount}/${maxStepsLabel}.`

  return {
    turnSuffix,
    segments: { baseSystemPrompt, planSection, pinnedBlock, activeFileBlock, skillsSection, attachedBlock, mapBlock },
  }
}
