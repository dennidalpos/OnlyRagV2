import { DiagnosticOutputReducer } from './diagnosticOutputReducer'

export interface PromptSegment {
  /** Priority 1 — never compacted */
  systemPrompt: string
  /** Priority 1.5 — never compacted */
  activePlanBlock: string
  /** Priority 2 — compacted if over budget */
  pinnedFilesBlock: string
  /** Priority 2 — compacted if over budget */
  activeFileBlock: string
  /** Priority 2.5 — compacted if over budget */
  skillsBlock: string
  /** Priority 3 — aggressively truncated above 75% watermark */
  historyBlock: string
  /** Priority 4 — first to be removed when over budget */
  attachedContext: string
  /** Priority 4 — first to be removed when over budget */
  projectMapBlock: string
}

export interface CompactionResult {
  prompt: string
  wasCompacted: boolean
  originalChars: number
  finalChars: number
}

/**
 * Zero-cost heuristic context compactor triggered at a configurable watermark.
 * Uses deterministic truncation and DiagnosticOutputReducer to reduce prompt size
 * without invoking any additional LLM inference calls.
 */
export class HeuristicContextCompactor {
  private static readonly WATERMARK_RATIO = 0.75

  /**
   * Assembles the final prompt string, applying heuristic compaction
   * if total size exceeds the 75% watermark of the hardware context limit.
   */
  public static compile(
    segments: PromptSegment,
    hardwareMaxContextChars: number
  ): CompactionResult {
    const parts = this.buildParts(segments)
    const fullPrompt = parts.filter(Boolean).join('\n\n')
    const originalChars = fullPrompt.length

    const watermark = Math.floor(hardwareMaxContextChars * this.WATERMARK_RATIO)

    if (originalChars <= watermark) {
      return { prompt: fullPrompt, wasCompacted: false, originalChars, finalChars: originalChars }
    }

    // --- Heuristic Compaction ---
    const budget = Math.floor(hardwareMaxContextChars * 0.72)

    // Tier 1 (immutable): system prompt + active plan
    const immutableSize = (segments.systemPrompt || '').length + (segments.activePlanBlock || '').length

    let remaining = budget - immutableSize

    // Tier 2 caps: pinned files and active file
    const pinnedAlloc = Math.min(segments.pinnedFilesBlock.length, Math.floor(remaining * 0.30))
    const activeFileAlloc = Math.min(segments.activeFileBlock.length, Math.floor(remaining * 0.15))
    const skillsAlloc = Math.min(segments.skillsBlock.length, Math.floor(remaining * 0.10))
    remaining -= pinnedAlloc + activeFileAlloc + skillsAlloc

    // Tier 3: history — distill terminal outputs, keep top-level summary table
    const historyAlloc = Math.max(0, Math.floor(remaining * 0.70))
    const distilledHistory = this.compactHistoryBlock(segments.historyBlock, historyAlloc)

    // Tier 4: auxiliary context — what's left
    const auxRemaining = Math.max(0, remaining - historyAlloc)
    const attachedAlloc = Math.min(segments.attachedContext.length, Math.floor(auxRemaining * 0.60))
    const mapAlloc = Math.min(segments.projectMapBlock.length, Math.floor(auxRemaining * 0.40))

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

  /**
   * Applies intelligent truncation to a history block by distilling
   * terminal/diagnostic outputs and preserving the trajectory summary table.
   */
  private static compactHistoryBlock(historyBlock: string, maxChars: number): string {
    if (!historyBlock || historyBlock.length <= maxChars) return historyBlock

    // Preserve the trajectory table header and rows, distill raw outputs
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
    const distilledRaw = DiagnosticOutputReducer.distillTerminalOutput(
      rawOutputBuffer.join('\n'),
      Math.max(400, maxChars - tableStr.length - 100)
    )

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
