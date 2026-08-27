export interface AgentRunMetricsSnapshot {
  sessionId: string
  taskSuccess: boolean | null
  toolCalls: number
  successfulToolCalls: number
  failedToolCalls: number
  unsafeActions: number
  recoveryActions: number
  validToolCalls: number
  invalidToolCalls: number
  falseVerified: number
}

/** Test/fixture quality gate: a run with any false verification is invalid. */
export function assertZeroFalseVerified(runs: readonly AgentRunMetricsSnapshot[]): void {
  const violations = runs.filter((run) => run.falseVerified > 0)
  if (violations.length > 0) {
    throw new Error(`False verification threshold exceeded in ${violations.length} run(s).`)
  }
}

/** Mutable counters owned by exactly one agent run. No process-global counters are used. */
export class AgentRunMetrics {
  private readonly counters: AgentRunMetricsSnapshot

  constructor(sessionId: string) {
    this.counters = {
      sessionId,
      taskSuccess: null,
      toolCalls: 0,
      successfulToolCalls: 0,
      failedToolCalls: 0,
      unsafeActions: 0,
      recoveryActions: 0,
      validToolCalls: 0,
      invalidToolCalls: 0,
      falseVerified: 0,
    }
  }

  recordToolCall(valid = true): void {
    this.counters.toolCalls++
    if (valid) this.counters.validToolCalls++
    else this.counters.invalidToolCalls++
  }

  recordToolResult(success: boolean, output = '', toolName = ''): void {
    if (success) this.counters.successfulToolCalls++
    else this.counters.failedToolCalls++
    if (/security violation|policy block|blocked/i.test(output)) this.counters.unsafeActions++
    if (/rollback/i.test(toolName)) this.counters.recoveryActions++
  }

  recordInvalidTool(): void {
    this.counters.invalidToolCalls++
  }

  recordFalseVerified(): void {
    this.counters.falseVerified++
  }

  recordTaskOutcome(success: boolean): void {
    this.counters.taskSuccess = success
  }

  snapshot(): AgentRunMetricsSnapshot {
    return { ...this.counters }
  }
}
