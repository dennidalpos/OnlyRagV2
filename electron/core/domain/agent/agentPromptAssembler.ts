import { PromptCompiler } from './promptCompiler'
import type { OllamaRuntimeOptions } from './hardwareProfileResolver'
import type { AppSettings } from '../../../../src/types'
import type { AgentMode } from './agentTypes'

export interface PromptAssemblerInput {
  userTask: string
  initialUserTask?: string
  agentMode: AgentMode
  stepCount: number
  maxSteps: number
  workspacePath?: string | null
  isStandaloneMode?: boolean
  activeFile?: { name: string; path: string; content: string } | null
  pinnedFilesContextStr?: string
  skillsBlock?: string
  planBlock?: string
  toolOutputHistory: string[] | string
  attachedContext?: string
  projectContextMapStr?: string
  settings: AppSettings
  runtimeOpts: OllamaRuntimeOptions
  /** When true, omits the prose tool schema block — the model receives it via native tool-calling instead (see AGT2). */
  toolCallingCapable?: boolean
}

export interface AssembledPrompt {
  /** Full prompt text (stableSection + historyBlock + turnSuffix), for logging, num_ctx sizing, and as the default wire payload. */
  prompt: string
  /**
   * Everything except tool-history and per-turn status: system prompt, plan, pinned/active
   * files, skills, RAG/repo-map background. Identical across turns whenever none of these
   * inputs changed — used by agentOrchestratorAppService.ts to detect when it's safe to
   * reuse Ollama's `context` continuation instead of resending the full prompt (see AGT1).
   */
  stableSection: string
  /**
   * Tool-execution history block. Grows turn over turn as new steps complete; positioned
   * last (after stableSection) precisely so that new content is appended at the tail rather
   * than inserted mid-prompt — a prerequisite for detecting an append-only delta.
   */
  historyBlock: string
  /** Small always-resend per-turn text (recovery hint + step counter) — never part of the cached prefix. */
  turnSuffix: string
  /**
   * The individual, still-disjoint pieces that were concatenated into `stableSection`.
   * HeuristicContextCompactor must be fed THESE, never `stableSection` itself: passing the
   * joined section as its `systemPrompt` while also passing the same pieces separately counts
   * every byte twice, which both trips the watermark spuriously and drives the compactor's
   * `remaining` budget negative — silently zeroing the history allocation.
   */
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
    toolCallingCapable
  )

  // Priority 1.5: Dynamic Execution Plan & Goal Decomposition
  const planSection = planBlock ? `${planBlock}\n` : ''

  // Priority 2: Active File Snippet & Explicitly Pinned Workspace Code Files
  const activeFileBlock = activeFile
    ? `Active File Open in Editor: ${activeFile.name}\nSnippet:\n${(activeFile.content || '').slice(0, 8000)}\n`
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
