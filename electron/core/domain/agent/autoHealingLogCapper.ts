const AUTO_HEALING_MARKER = '[TERMINAL AUTO-HEALING DIAGNOSTICS LOG]'
const STEP_HEADER_REGEX = /^#### \[Step \d+ - Tool: [^\]]+\]$/

export interface AutoHealingCapResult {
  text: string
  capped: boolean
  totalBlocks: number
  removedBlocks: number
}

interface StepBlock {
  header: string
  lines: string[]
  isAutoHealing: boolean
}

/**
 * Caps the number of "[TERMINAL AUTO-HEALING DIAGNOSTICS LOG]" blocks retained
 * inside a compacted history text, keeping only the most recent N occurrences.
 * Older auto-healing blocks are collapsed to a one-line placeholder so that
 * repeated build/test failure diagnostics don't crowd out newer turn context
 * once the heuristic context watermark has been exceeded.
 */
export class AutoHealingLogCapper {
  public static capBlocks(historyText: string, maxBlocks: number = 2): AutoHealingCapResult {
    if (!historyText) {
      return { text: historyText, capped: false, totalBlocks: 0, removedBlocks: 0 }
    }

    const { preamble, blocks } = this.parseBlocks(historyText)
    const autoHealingIndexes = blocks
      .map((block, idx) => (block.isAutoHealing ? idx : -1))
      .filter((idx) => idx !== -1)

    const totalBlocks = autoHealingIndexes.length
    if (totalBlocks <= maxBlocks) {
      return { text: historyText, capped: false, totalBlocks, removedBlocks: 0 }
    }

    const keepIndexes = new Set(autoHealingIndexes.slice(-maxBlocks))
    const removedBlocks = totalBlocks - keepIndexes.size

    const rebuiltBlocks = blocks.map((block, idx) => {
      if (block.isAutoHealing && !keepIndexes.has(idx)) {
        return `${block.header}\n[auto-healing diagnostics compacted — older log omitted to save context]`
      }
      return block.lines.join('\n')
    })

    const rebuiltText = [preamble.join('\n'), ...rebuiltBlocks].filter((s) => s.length > 0).join('\n')

    return { text: rebuiltText, capped: true, totalBlocks, removedBlocks }
  }

  /**
   * Splits raw history text into a preamble (any content before the first
   * "#### [Step N - Tool: X]" header) and a sequence of per-step blocks.
   */
  private static parseBlocks(historyText: string): { preamble: string[]; blocks: StepBlock[] } {
    const lines = historyText.split('\n')
    const preamble: string[] = []
    const blocks: StepBlock[] = []
    let current: StepBlock | null = null

    for (const line of lines) {
      if (STEP_HEADER_REGEX.test(line)) {
        if (current) blocks.push(current)
        current = { header: line, lines: [line], isAutoHealing: false }
        continue
      }
      if (current) {
        current.lines.push(line)
        if (line.includes(AUTO_HEALING_MARKER)) {
          current.isAutoHealing = true
        }
      } else {
        preamble.push(line)
      }
    }
    if (current) blocks.push(current)

    return { preamble, blocks }
  }
}
