export type AgentExecutionPhase =
  | 'collect_context'
  | 'propose_action'
  | 'apply_action'
  | 'verify'
  | 'outcome'

const allowedTransitions: Record<AgentExecutionPhase, readonly AgentExecutionPhase[]> = {
  collect_context: ['propose_action', 'outcome'],
  propose_action: ['apply_action', 'collect_context', 'outcome'],
  apply_action: ['verify', 'collect_context', 'outcome'],
  verify: ['collect_context', 'outcome'],
  outcome: [],
}

export class AgentExecutionPhaseController {
  private phase: AgentExecutionPhase = 'collect_context'

  getPhase(): AgentExecutionPhase {
    return this.phase
  }

  transition(next: AgentExecutionPhase): void {
    if (next === this.phase) return
    if (!allowedTransitions[this.phase].includes(next)) {
      throw new Error(`Invalid agent phase transition: ${this.phase} -> ${next}`)
    }
    this.phase = next
  }
}
