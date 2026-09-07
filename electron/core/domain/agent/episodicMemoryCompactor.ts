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
  /** Tool target (file path / command), used to collapse repeated failures on the same target. */
  target?: string
}

const FILE_MUTATION_TOOLS = new Set([
  'write_file',
  'replace_file_content',
  'multi_replace_file_content',
  'delete_file',
  'download_file',
  'copy_file',
  'move_file',
  'create_directory',
])
const WORKSPACE_SNAPSHOT_TOOLS = new Set(['run_command', 'run_tests'])

function normalizedTarget(target?: string): string {
  return (target || '').trim().replace(/[\\/]+/g, '/')
}

function isSuccessfulFileMutation(log: EpisodicFullLog): boolean {
  return !log.isFailure && FILE_MUTATION_TOOLS.has(log.tool)
}

function isInvalidatedByMutation(log: EpisodicFullLog, mutationTarget?: string): boolean {
  if (WORKSPACE_SNAPSHOT_TOOLS.has(log.tool)) return true
  const target = normalizedTarget(log.target)
  return Boolean(target && target === normalizedTarget(mutationTarget))
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

  private expireWorkspaceStateOutputs(mutationTarget?: string): void {
    // Full command/test output describes one workspace revision, and per-file output describes
    // one file revision. A successful mutation makes those earlier details assertions about a
    // state that no longer exists. The compact trajectory still records that each action ran;
    // only its actionable body expires, preventing an old diagnostic from continuing to order
    // edits after the disk changed. Unrelated file reads remain available.
    const remainsCurrent = (log: EpisodicFullLog) => !isInvalidatedByMutation(log, mutationTarget)
    this.failureLogs = this.failureLogs.filter(remainsCurrent)
    this.recentFullLogs = this.recentFullLogs.filter(remainsCurrent)
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
      target: record.target,
    }

    if (isSuccessfulFileMutation(logEntry)) {
      this.expireWorkspaceStateOutputs(logEntry.target)
    }

    if (logEntry.isFailure) {
      // Deduplicate failure logs by tool+target across the whole buffer to prevent escalating intervention
      // counters from crowding out real diagnostics. Re-append to keep newest failure at the end.
      const keyOf = (log: EpisodicFullLog) => `${log.tool}\u0000${log.target || ''}`
      const existingIndex = this.failureLogs.findIndex((l) => keyOf(l) === keyOf(logEntry))
      if (existingIndex !== -1) {
        // Removed and re-appended rather than overwritten in place: the newest failure is also
        // the most relevant, so it should sit at the end where the budget trims last.
        this.failureLogs.splice(existingIndex, 1)
      }
      this.failureLogs.push(logEntry)
      if (this.failureLogs.length > 8) {
        this.failureLogs.shift()
      }
    }

    // Deduplicate repeated failures on the same tool+target in recentFullLogs to prevent FIFO intervention crowding.
    if (logEntry.isFailure) {
      const recentIndex = this.recentFullLogs.findIndex(
        (l) => l.isFailure && l.tool === logEntry.tool && (l.target || '') === (logEntry.target || '')
      )
      if (recentIndex !== -1) {
        this.recentFullLogs.splice(recentIndex, 1)
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

    // "Last N Steps" stopped being true when repeated interventions on one target began
    // collapsing into a single slot: the entries are the most recent DISTINCT actions, and may
    // reach further back than N steps. The header says what the list is.
    const detailedSection = `\n\n### RECENT DETAILED TOOL OUTPUTS (${this.recentFullLogs.length} most recent distinct actions):\n${detailedOutputs}`

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

  /**
   * The output of the most recent FAILED run of a command, or null when there is none.
   *
   * Exists so a plan-block directive can carry the diagnostic itself instead of pointing at it.
   * verificationAttemptTracker used to say "do what that directive says", meaning one sitting in
   * the tool history: measured 2026-08-25T20:24, the model could not follow the indirection and
   * spent steps 34 to 50 reissuing a blocked `write_file` on src/index.html, seventeen turns to
   * the ceiling. The two channels have different lifetimes, so a cross-reference between them is
   * a pointer that can dangle.
   *
   * Loose matching on the command, for the reason isVerificationFailing matches loosely: the
   * model does not always spell it identically.
   */
  public lastFailureOutputFor(tool: string, commandNeedle: string): string | null {
    const needle = (commandNeedle || '').trim().toLowerCase()
    if (!needle) return null
    for (const buffer of [this.failureLogs, this.recentFullLogs]) {
      for (let i = buffer.length - 1; i >= 0; i--) {
        const entry = buffer[i]
        if (entry.tool !== tool || !entry.isFailure) continue
        if (!(entry.target || '').trim().toLowerCase().includes(needle)) continue
        return entry.output
      }
    }
    return null
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
    this.recentFullLogs = []
    this.failureLogs = []
    for (const log of recentLogs || []) {
      if (isSuccessfulFileMutation(log)) {
        this.expireWorkspaceStateOutputs(log.target)
      }
      this.recentFullLogs.push({ ...log })
      if (log.isFailure) this.failureLogs.push({ ...log })
    }
    while (this.recentFullLogs.length > this.maxRecentDetailedSteps) {
      this.recentFullLogs.shift()
    }
  }

  public reset(): void {
    this.episodes = []
    this.recentFullLogs = []
    this.failureLogs = []
  }
}
