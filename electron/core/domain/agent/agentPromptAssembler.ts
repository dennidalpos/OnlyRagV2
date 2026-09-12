import { PromptCompiler } from '../../../../shared/domain/agent/promptCompiler'
import type { OllamaRuntimeOptions } from './hardwareProfileResolver'
import type { AppSettings } from '../../../../shared/types'
import type { ActiveFileContext } from './agentTypes'
import type { AgentMode, SupportedToolName } from './agentTypes'
import { renderToolPromptCatalog } from './ollamaToolSchemaCatalog'

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
  toolOutputHistory: string[] | string
  attachedContext?: string
  projectContextMapStr?: string
  settings: AppSettings
  runtimeOpts: OllamaRuntimeOptions
  /** Omits the prose schema when native tool calling is active. */
  toolCallingCapable?: boolean
  /** Application-selected tools for this proposal. */
  availableToolNames?: readonly SupportedToolName[]
}

export interface AssembledPrompt {
  /** Full prompt used for logging, sizing and transport. */
  prompt: string
  /** Stable prompt prefix excluding tool history and per-turn status. */
  stableSection: string
  /** Tool history appended after the stable prompt prefix. */
  historyBlock: string
  /** Per-turn recovery hint and step counter. */
  turnSuffix: string
  /** Disjoint pieces used to build and compact `stableSection`. */
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
 * Assembles a priority-budgeted prompt fitting within the hardware profile context limit.
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
    toolOutputHistory,
    attachedContext,
    projectContextMapStr,
    settings,
    runtimeOpts,
    toolCallingCapable,
    availableToolNames,
  } = input

  // Format combined user task if initial task exists and differs from turn prompt
  const effectiveTaskText = initialUserTask && initialUserTask.trim() !== userTask.trim()
    ? `PRIMARY OVERALL GOAL / PROJECT SPECIFICATION:\n"""\n${initialUserTask.trim()}\n"""\n\nCURRENT TURN INSTRUCTION / FOLLOW-UP ANSWER:\n"""\n${userTask.trim()}\n"""`
    : userTask.trim()

  const now = new Date()
  const formattedDate = now.toLocaleDateString('it-IT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const currentDate = `${now.toISOString().split('T')[0]} (${formattedDate})`

  // Priority 1: Base System Prompt & User Goal Guidelines (Mandatory intact).
  // Family-agnostic and tier-free — one configured coding model, one prompt.
  // Deliberately excludes the per-turn step counter (see turnSuffix below) so this
  // block stays byte-identical across turns whenever nothing else changed (AGT1).
  const { prompt: baseSystemPrompt } = PromptCompiler.compileCodingPrompt(
    {
      agentMode: agentMode.toUpperCase(),
      userTask: effectiveTaskText,
      workspacePath: isStandaloneMode ? 'Standalone (No Workspace)' : (workspacePath || 'No Folder Selected'),
      currentDate,
    },
    settings,
    toolCallingCapable,
    availableToolNames ? renderToolPromptCatalog(availableToolNames) : undefined
  )

  // Priority 1.5: Dynamic Execution Plan & Goal Decomposition
  const planSection = planBlock ? `${planBlock}\n` : ''

  // Priority 2: Active File Snippet & Explicitly Pinned Workspace Code Files
  const activeFileBlock = activeFile
    ? `Active File Open in Editor: ${activeFile.name} (${activeFile.path})\n[EDITOR VERSION: ${activeFile.versionHash}]\nSnippet:\n${activeFile.content.slice(0, 8000)}\n`
    : ''
  const pinnedBlock = pinnedFilesContextStr
    ? `EXPLICITLY REFERENCED (PINNED) WORKSPACE FILES:\n${pinnedFilesContextStr.slice(0, 16000)}\n`
    : ''

  // Priority 2.5: Contextual Domain Skills & Guidelines
  const skillsSection = skillsBlock ? `${skillsBlock}\n` : ''

  // Priority 3: Auxiliary Background Context (RAG docs & Repository Tree Map).
  // Budgeted as a SHARE of the profile's context allowance rather than by fixed thresholds:
  // the old `<= 16000 ? 2500 : 6000` step handed a 19k-char profile 16k of background context,
  // leaving almost nothing for tool history — the one block the agent needs to make progress.
  const maxRAGChars = Math.floor(runtimeOpts.maxContextChars * 0.12)
  const maxMapChars = Math.floor(runtimeOpts.maxContextChars * 0.18)
  const attachedBlock = attachedContext ? `ATTACHED RAG DOCS CONTEXT:\n${attachedContext.slice(0, maxRAGChars)}\n` : ''
  const mapBlock = projectContextMapStr ? `FULL REPOSITORY WORKSPACE MAP (${workspacePath}):\n${projectContextMapStr.slice(0, maxMapChars)}\n` : ''

  // Priority 4: Tool Execution History (Episodic Trajectory & Recent Detailed Outputs).
  // Positioned LAST (after all background context above) so it is the sole growing,
  // append-only tail of the prompt — see AssembledPrompt.historyBlock.
  let historyBlock = ''
  let recoveryHint = ''

  if (typeof toolOutputHistory === 'string' && toolOutputHistory.trim()) {
    historyBlock = `\n${toolOutputHistory.slice(0, 10000)}\n`
    if (toolOutputHistory.includes('TOOL PARSER REJECTION DIAGNOSTIC') || toolOutputHistory.includes('NO TOOL INVOCATION DETECTED')) {
      recoveryHint = `\nCRITICAL RECOVERY DIRECTIVE:\nYour previous tool invocation failed to parse. Correct your syntax NOW: Emit EXACTLY ONE JSON block wrapped in \`\`\`json { "tool": "tool_name", "parameters": { ... }, "explanation": "..." } \`\`\`. Do NOT emit raw markdown shell code blocks or arrays for parameters.\n`
    }
  } else if (Array.isArray(toolOutputHistory) && toolOutputHistory.length > 0) {
    const historyStr = toolOutputHistory.join('\n\n')
    historyBlock = `\nPREVIOUS COMPLETED TOOL STEPS & RESULTS:\n${historyStr.slice(0, 10000)}\n`
    if (historyStr.includes('TOOL PARSER REJECTION DIAGNOSTIC') || historyStr.includes('NO TOOL INVOCATION DETECTED')) {
      recoveryHint = `\nCRITICAL RECOVERY DIRECTIVE:\nYour previous tool invocation failed to parse. Correct your syntax NOW: Emit EXACTLY ONE JSON block wrapped in \`\`\`json { "tool": "tool_name", "parameters": { ... }, "explanation": "..." } \`\`\`. Do NOT emit raw markdown shell code blocks or arrays for parameters.\n`
    }
  }

  const stableParts = [baseSystemPrompt, planSection, pinnedBlock, activeFileBlock, skillsSection, attachedBlock, mapBlock]
    .filter((p) => Boolean(p && p.trim()))
  const stableSection = stableParts.join('\n\n')

  const maxStepsLabel = maxSteps === Infinity || maxSteps === 0 ? '∞' : String(maxSteps)
  const turnStatusLine = `CURRENT TURN STATUS: Step ${stepCount}/${maxStepsLabel}.`
  const turnSuffix = [recoveryHint, turnStatusLine].filter((p) => Boolean(p && p.trim())).join('\n\n')

  // Compaction over the hardware profile limit is handled exclusively by
  // HeuristicContextCompactor.compile in the orchestrator loop (single
  // point of truncation — see agentOrchestratorAppService.ts).
  const prompt = [stableSection, historyBlock, turnSuffix].filter((p) => Boolean(p && p.trim())).join('\n\n')

  return {
    prompt,
    stableSection,
    historyBlock,
    turnSuffix,
    segments: { baseSystemPrompt, planSection, pinnedBlock, activeFileBlock, skillsSection, attachedBlock, mapBlock },
  }
}
