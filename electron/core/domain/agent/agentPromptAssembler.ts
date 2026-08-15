import { PromptCompiler } from './promptCompiler'
import { HardwareProfileResolver, OllamaRuntimeOptions } from './hardwareProfileResolver'
import type { AppSettings } from '../../../../src/types'
import type { AgentMode } from './agentTypes'

export interface PromptAssemblerInput {
  userTask: string
  agentMode: AgentMode
  stepCount: number
  maxSteps: number
  targetModel: string
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
}

export class AgentPromptAssembler {
  /**
   * Assembles a 4-tier token budgeted prompt fitting within the hardware profile context limit.
   */
  static assembleTurnPrompt(input: PromptAssemblerInput): string {
    const {
      userTask,
      agentMode,
      stepCount,
      maxSteps,
      targetModel,
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
    } = input

    // Priority 1: Base System Prompt & User Goal Guidelines (Mandatory intact)
    const { prompt: baseSystemPrompt } = PromptCompiler.compilePrompt(
      'coding',
      targetModel,
      {
        agentMode: agentMode.toUpperCase(),
        stepCount: String(stepCount),
        MAX_STEPS: maxSteps === Infinity || maxSteps === 0 ? '∞' : String(maxSteps),
        userTask,
        workspacePath: isStandaloneMode ? 'Standalone (No Workspace)' : (workspacePath || 'No Folder Selected'),
      },
      settings
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

    // Priority 3: Tool Execution History (Episodic Trajectory & Recent Detailed Outputs)
    let historyBlock = ''
    if (typeof toolOutputHistory === 'string' && toolOutputHistory.trim()) {
      historyBlock = `\n${toolOutputHistory.slice(0, 10000)}\n`
    } else if (Array.isArray(toolOutputHistory) && toolOutputHistory.length > 0) {
      historyBlock = `\nPREVIOUS COMPLETED TOOL STEPS & RESULTS:\n${toolOutputHistory.join('\n\n').slice(0, 10000)}\n`
    }

    // Priority 4: Auxiliary Background Context (RAG docs & Repository Tree Map)
    const maxRAGChars = runtimeOpts.maxContextChars <= 16000 ? 2500 : 6000
    const maxMapChars = runtimeOpts.maxContextChars <= 16000 ? 4000 : 10000
    const attachedBlock = attachedContext ? `ATTACHED RAG DOCS CONTEXT:\n${attachedContext.slice(0, maxRAGChars)}\n` : ''
    const mapBlock = projectContextMapStr ? `FULL REPOSITORY WORKSPACE MAP (${workspacePath}):\n${projectContextMapStr.slice(0, maxMapChars)}\n` : ''

    const promptParts = [
      baseSystemPrompt,
      planSection,
      pinnedBlock,
      activeFileBlock,
      skillsSection,
      historyBlock,
      attachedBlock,
      mapBlock,
    ].filter((p) => Boolean(p && p.trim()))

    let fullPrompt = promptParts.join('\n\n')

    // Dynamic Compaction if total exceeds hardware profile limit
    if (fullPrompt.length > runtimeOpts.maxContextChars) {
      const compactedParts = [
        baseSystemPrompt,
        planSection,
        pinnedBlock ? pinnedBlock.slice(0, 8000) : '',
        activeFileBlock ? activeFileBlock.slice(0, 4000) : '',
        skillsSection,
        historyBlock ? historyBlock.slice(0, 6000) : '',
        attachedBlock ? attachedBlock.slice(0, 1500) : '',
        mapBlock ? mapBlock.slice(0, 2000) : '',
      ].filter(Boolean)
      fullPrompt = compactedParts.join('\n\n')
    }

    return fullPrompt
  }
}
