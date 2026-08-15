export interface EpisodicStepRecord {
  step: number
  tool: string
  target?: string
  status: 'SUCCESS' | 'FAILURE' | 'BLOCKED'
  summary: string
}

export interface EpisodicFullLog {
  step: number
  tool: string
  output: string
  isFailure?: boolean
}

/**
 * Compacts multi-turn agent history by maintaining a structured milestone trajectory,
 * preserving tool failure diagnostics, and retaining high-fidelity recent raw tool logs.
 */
export class EpisodicMemoryCompactor {
  private episodes: EpisodicStepRecord[] = []
  private recentFullLogs: EpisodicFullLog[] = []
  private failureLogs: EpisodicFullLog[] = []
  private readonly maxRecentDetailedSteps: number

  constructor(maxRecentDetailedSteps: number = 6) {
    this.maxRecentDetailedSteps = maxRecentDetailedSteps
  }

  public recordStep(record: EpisodicStepRecord, rawOutput: string): void {
    this.episodes.push(record)
    if (this.episodes.length > 100) {
      this.episodes.splice(1, this.episodes.length - 100)
    }

    const truncated = rawOutput.length > 2500
      ? `${rawOutput.slice(0, 2500)}\n... [Output truncated for memory budget]`
      : rawOutput

    const logEntry: EpisodicFullLog = {
      step: record.step,
      tool: record.tool,
      output: truncated,
      isFailure: record.status === 'FAILURE' || record.status === 'BLOCKED',
    }

    if (logEntry.isFailure) {
      // Keep failure logs in a dedicated buffer (deduplicated) so they are never lost to FIFO shifting
      const lastFailure = this.failureLogs[this.failureLogs.length - 1]
      if (!lastFailure || lastFailure.output !== logEntry.output || lastFailure.tool !== logEntry.tool) {
        this.failureLogs.push(logEntry)
        if (this.failureLogs.length > 8) {
          this.failureLogs.shift()
        }
      }
    }

    this.recentFullLogs.push(logEntry)

    while (this.recentFullLogs.length > this.maxRecentDetailedSteps) {
      this.recentFullLogs.shift()
    }
  }

  public compilePromptHistoryBlock(maxBudgetChars: number = 10000): string {
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

    // Always include critical failure diagnostics to prevent oscillation loops (e.g. replace_file_content errors)
    let failureSection = ''
    if (this.failureLogs.length > 0) {
      const failureOutputs = this.failureLogs.map((l) => {
        return `#### [FAILURE at Step ${l.step} - Tool: ${l.tool}]\n\`\`\`\n${l.output}\n\`\`\``
      }).join('\n\n')
      failureSection = `\n\n### CRITICAL PREVIOUS TOOL FAILURES & DIAGNOSTICS (Analyze Carefully - Do Not Repeat Failed Inputs):\n${failureOutputs}`
    }

    // Deduplicate consecutive identical read tool calls in recentDetailedLogs
    const deduplicatedLogs: EpisodicFullLog[] = []
    for (const log of this.recentFullLogs) {
      const prev = deduplicatedLogs[deduplicatedLogs.length - 1]
      if (
        prev &&
        prev.tool === log.tool &&
        ['read_file', 'list_dir', 'grep_search'].includes(log.tool) &&
        prev.output === log.output
      ) {
        continue
      }
      deduplicatedLogs.push(log)
    }

    const detailedOutputs = deduplicatedLogs.map((l) => {
      return `#### [Step ${l.step} - Tool: ${l.tool}]\n\`\`\`\n${l.output}\n\`\`\``
    }).join('\n\n')

    const detailedSection = `\n\n### RECENT DETAILED TOOL OUTPUTS (Last ${this.recentFullLogs.length} Steps):\n${detailedOutputs}`

    const combined = `${trajectoryTable}${failureSection}${detailedSection}`
    if (combined.length <= maxBudgetChars) {
      return combined
    }

    // If over budget, compress trajectory while retaining full failure diagnostics
    const compressedTrajectory = [
      '### COMPLETE EXECUTION TRAJECTORY (Step History):',
      '| Step | Tool | Target | Status | Outcome Summary |',
      '|:---:|:---|:---|:---:|:---|',
      ...trajectoryLines.slice(-15),
    ].join('\n')

    const compressed = `${compressedTrajectory}${failureSection}${detailedSection}`
    if (compressed.length <= maxBudgetChars) {
      return compressed
    }
    return compressed.slice(-maxBudgetChars)
  }

  public get episodeCount(): number {
    return this.episodes.length
  }

  public get failureCount(): number {
    return this.episodes.filter((e) => e.status === 'FAILURE' || e.status === 'BLOCKED').length
  }

  public getEpisodes(): EpisodicStepRecord[] {
    return [...this.episodes]
  }

  public getRecentFullLogs(): EpisodicFullLog[] {
    return [...this.recentFullLogs]
  }

  public toState(): { episodes: EpisodicStepRecord[]; recentFullLogs: EpisodicFullLog[] } {
    return {
      episodes: this.getEpisodes(),
      recentFullLogs: this.getRecentFullLogs(),
    }
  }

  public fromState(episodes: EpisodicStepRecord[], recentLogs: EpisodicFullLog[]): void {
    this.episodes = episodes ? [...episodes] : []
    this.recentFullLogs = recentLogs ? [...recentLogs] : []
    this.failureLogs = (recentLogs || []).filter((l) => l.isFailure)
  }

  public reset(): void {
    this.episodes = []
    this.recentFullLogs = []
    this.failureLogs = []
  }
}
