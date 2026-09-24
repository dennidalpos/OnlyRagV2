import { DiagnosticOutputReducer } from './diagnosticOutputReducer'
import { AutoHealingLogCapper } from './autoHealingLogCapper'

export interface PromptSegment {
  systemPrompt: string
  activePlanBlock: string
  pinnedFilesBlock: string
  activeFileBlock: string
  skillsBlock: string
  historyBlock: string
  attachedContext: string
  projectMapBlock: string
}

export interface CompactionResult {
  prompt: string
  wasCompacted: boolean
  originalChars: number
  finalChars: number
}

/** Heuristic context compactor triggered at watermark. */
export class HeuristicContextCompactor {
  private static readonly WATERMARK_RATIO = 0.75

  /** Assembles final prompt string, applying heuristic compaction if over watermark. */
  public static compile(segments: PromptSegment, hardwareMaxContextChars: number, options: { force?: boolean } = {}): CompactionResult {
    const parts = this.buildParts(segments)
    const fullPrompt = parts.filter(Boolean).join('\n\n')
    const originalChars = fullPrompt.length

    const watermark = Math.floor(hardwareMaxContextChars * this.WATERMARK_RATIO)

    if (!options.force && originalChars <= watermark) {
      return { prompt: fullPrompt, wasCompacted: false, originalChars, finalChars: originalChars }
    }

    // Tier 1: system prompt + active plan (immutable)
    const immutableSize = (segments.systemPrompt || '').length + (segments.activePlanBlock || '').length
    const regularBudget = Math.floor(hardwareMaxContextChars * 0.72)
    const budget = options.force ? Math.max(immutableSize, Math.min(regularBudget, Math.floor(originalChars * 0.65))) : regularBudget

    // Ensure history floor to maintain agent statefulness
    const historyFloor = Math.min(segments.historyBlock.length, Math.max(0, Math.floor(hardwareMaxContextChars * 0.2)))
    let remaining = Math.max(0, budget - immutableSize)

    // Tier 2: pinned files, active file, skills
    const tier2Pool = Math.max(0, remaining - historyFloor)
    const pinnedAlloc = Math.min(segments.pinnedFilesBlock.length, Math.floor(tier2Pool * 0.3))
    const activeFileAlloc = Math.min(segments.activeFileBlock.length, Math.floor(tier2Pool * 0.15))
    const skillsAlloc = Math.min(segments.skillsBlock.length, Math.floor(tier2Pool * 0.1))
    remaining = Math.max(0, remaining - (pinnedAlloc + activeFileAlloc + skillsAlloc))

    // Tier 3: history distillation
    const historyAlloc = Math.max(historyFloor, Math.floor(remaining * 0.7))
    const distilledHistory = this.compactHistoryBlock(segments.historyBlock, historyAlloc)

    // Tier 4: auxiliary context
    const auxRemaining = Math.max(0, remaining - historyAlloc)
    const attachedAlloc = Math.min(segments.attachedContext.length, Math.floor(auxRemaining * 0.6))
    const mapAlloc = Math.min(segments.projectMapBlock.length, Math.floor(auxRemaining * 0.4))

    const compactedParts = [
      segments.systemPrompt,
      segments.activePlanBlock,
      pinnedAlloc > 0 ? segments.pinnedFilesBlock.slice(0, pinnedAlloc) : '',
      activeFileAlloc > 0 ? segments.activeFileBlock.slice(0, activeFileAlloc) : '',
      skillsAlloc > 0 ? segments.skillsBlock.slice(0, skillsAlloc) : '',
      distilledHistory,
      attachedAlloc > 0 ? segments.attachedContext.slice(0, attachedAlloc) : '',
      mapAlloc > 0 ? segments.projectMapBlock.slice(0, mapAlloc) : '',
    ].filter(Boolean)

    const finalPrompt = compactedParts.join('\n\n')

    return {
      prompt: finalPrompt,
      wasCompacted: true,
      originalChars,
      finalChars: finalPrompt.length,
    }
  }

  /** Distills terminal/diagnostic outputs while preserving trajectory summary table. */
  private static compactHistoryBlock(historyBlock: string, maxChars: number): string {
    if (!historyBlock || historyBlock.length <= maxChars) return historyBlock

    const lines = historyBlock.split('\n')
    const tableLines: string[] = []
    const rawOutputBuffer: string[] = []
    let inTable = false
    let inOutput = false

    for (const line of lines) {
      if (line.startsWith('### COMPLETE EXECUTION TRAJECTORY')) {
        inTable = true
        inOutput = false
        tableLines.push(line)
      } else if (line.startsWith('### RECENT DETAILED TOOL OUTPUTS')) {
        inTable = false
        inOutput = true
        tableLines.push(line)
      } else if (inTable || (!inOutput && line.startsWith('|'))) {
        tableLines.push(line)
      } else if (inOutput) {
        rawOutputBuffer.push(line)
      }
    }

    const tableStr = tableLines.join('\n')

    // Cap diagnostics log blocks to 2 most recent before distillation
    const { text: cappedRawOutput } = AutoHealingLogCapper.capBlocks(rawOutputBuffer.join('\n'), 2)

    const distilledRaw = DiagnosticOutputReducer.distillTerminalOutput(cappedRawOutput, Math.max(400, maxChars - tableStr.length - 100))

    const combined = distilledRaw ? `${tableStr}\n${distilledRaw}` : tableStr
    return combined.length > maxChars ? combined.slice(0, maxChars) + '\n...[compacted]' : combined
  }

  private static buildParts(segments: PromptSegment): string[] {
    return [
      segments.systemPrompt,
      segments.activePlanBlock,
      segments.pinnedFilesBlock,
      segments.activeFileBlock,
      segments.skillsBlock,
      segments.historyBlock,
      segments.attachedContext,
      segments.projectMapBlock,
    ]
  }
}
