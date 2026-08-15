export interface EpisodicStepRecord {
  step: number
  tool: string
  target?: string
  status: 'SUCCESS' | 'FAILURE' | 'BLOCKED'
  summary: string
}

/**
 * Compacts multi-turn agent history by maintaining a structured milestone trajectory
 * and retaining high-fidelity recent raw tool logs, preventing FIFO context drift.
 */
export class EpisodicMemoryCompactor {
  private episodes: EpisodicStepRecord[] = []
  private recentFullLogs: { step: number; tool: string; output: string }[] = []
  private readonly maxRecentDetailedSteps: number

  constructor(maxRecentDetailedSteps: number = 4) {
    this.maxRecentDetailedSteps = maxRecentDetailedSteps
  }

  public recordStep(record: EpisodicStepRecord, rawOutput: string): void {
    this.episodes.push(record)

    const truncated = rawOutput.length > 2500
      ? `${rawOutput.slice(0, 2500)}\n... [Output truncated for memory budget]`
      : rawOutput

    this.recentFullLogs.push({
      step: record.step,
      tool: record.tool,
      output: truncated,
    })

    while (this.recentFullLogs.length > this.maxRecentDetailedSteps) {
      this.recentFullLogs.shift()
    }
  }

  public compilePromptHistoryBlock(maxBudgetChars: number = 9000): string {
    if (this.episodes.length === 0) return ''

    const trajectoryLines = this.episodes.map((e) => {
      const cleanTarget = (e.target || '-').replace(/[\r\n|]/g, ' ')
      const cleanSummary = (e.summary || '').replace(/[\r\n|]/g, ' ').slice(0, 80)
      return `| Step ${e.step} | \`${e.tool}\` | ${cleanTarget} | ${e.status} | ${cleanSummary} |`
    })

    const trajectoryTable = [
      '### COMPLETE EXECUTION TRAJECTORY (Step History):',
      '| Step | Tool | Target | Status | Outcome Summary |',
      '|:---:|:---|:---|:---:|:---|',
      ...trajectoryLines,
    ].join('\n')

    const detailedOutputs = this.recentFullLogs.map((l) => {
      return `#### [Step ${l.step} - Tool: ${l.tool}]\n\`\`\`\n${l.output}\n\`\`\``
    }).join('\n\n')

    const detailedSection = `\n\n### RECENT DETAILED TOOL OUTPUTS (Last ${this.recentFullLogs.length} Steps):\n${detailedOutputs}`

    const combined = `${trajectoryTable}${detailedSection}`
    if (combined.length <= maxBudgetChars) {
      return combined
    }

    // If over budget, compress trajectory and detailed section proportionally
    const compressedTrajectory = [
      '### COMPLETE EXECUTION TRAJECTORY (Step History):',
      '| Step | Tool | Target | Status | Outcome Summary |',
      '|:---:|:---|:---|:---:|:---|',
      ...trajectoryLines.slice(-15),
    ].join('\n')

    const compressed = `${compressedTrajectory}${detailedSection}`
    return compressed.slice(-maxBudgetChars)
  }

  public get episodeCount(): number {
    return this.episodes.length
  }

  public get failureCount(): number {
    return this.episodes.filter((e) => e.status === 'FAILURE').length
  }

  public reset(): void {
    this.episodes = []
    this.recentFullLogs = []
  }
}
