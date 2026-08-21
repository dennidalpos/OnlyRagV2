export interface CycleDetectionResult {
  isOscillating: boolean
  cycleLength?: number
  suggestedDirective?: string
}

export class CycleOscillationDetectorAndReproOracle {
  private actionHistory: string[] = []
  private readonly maxHistoryLength = 20

  /**
   * Generates a unique state key from tool invocation parameters.
   */
  private hashAction(toolName: string, params: Record<string, any>): string {
    const target = params.filePath || params.command || params.targetContent || params.url || ''
    return `${toolName}:${target}`
  }

  /**
   * Detects multi-step cycle oscillations (e.g. A -> B -> A -> B or A -> B -> C -> A -> B -> C).
   */
  public recordAndDetectCycle(toolName: string, params: Record<string, any>): CycleDetectionResult {
    const actionKey = this.hashAction(toolName, params)
    this.actionHistory.push(actionKey)

    if (this.actionHistory.length > this.maxHistoryLength) {
      this.actionHistory.shift()
    }

    const n = this.actionHistory.length
    // Evaluate cycles of length k from 2 to 4
    for (let k = 2; k <= 4; k++) {
      if (n >= k * 2) {
        const pattern1 = this.actionHistory.slice(n - k).join('|')
        const pattern2 = this.actionHistory.slice(n - 2 * k, n - k).join('|')

        if (pattern1 === pattern2) {
          return {
            isOscillating: true,
            cycleLength: k,
            suggestedDirective: `[OSCILLATION DETECTED] You are trapped in an oscillating loop of length ${k}. You MUST STOP repeating these edits. Re-read the target file with read_file, run a test command with run_command, or re-evaluate your plan strategy.`,
          }
        }
      }
    }

    return { isOscillating: false }
  }
}
