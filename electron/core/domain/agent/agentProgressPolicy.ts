import type { AgentGuardId } from '../../../../shared/types'
import type { AgentLocalizedText } from '../../../../shared/domain/agent/agentMainText'
import type { RepeatOutcomeKind } from './loopDetector'
import { recordRecoveryFailure, type RecoveryDecision, type RecoveryFailureState } from './recoveryBudget'

/** Non-progress thresholds bounding stalls and loops for an agent run. */
export const PROGRESS_BUDGET = {
  /** Prose-only replies with work open. */
  proseReplies: 2,
  /** Steps without mutation before stopping. */
  stepsWithoutMutation: 12,
  /** Loop blocks answered with advice alone before force_advance. */
  advisoryLoopBlocks: 2,
  /** Loop blocks before stagnation abort. */
  abortLoopBlocks: 20,
  /** Blocks of previously succeeded action before treating as loop. */
  redundantSuccessBlocks: 3,
  /** Vague questions redirected in AUTO mode. */
  askRedirects: 2,
} as const

export type ProgressBudget = { [K in keyof typeof PROGRESS_BUDGET]: number }

export interface ProgressPolicySnapshot {
  schemaFailure?: RecoveryFailureState
  executionFailure?: RecoveryFailureState
}

export type LoopBlockDecision =
  | { kind: 'redundant'; redundantBlocks: number }
  | { kind: 'stagnation'; loopBlocks: number; escape: 'advise' | 'force_milestone_advance' | 'abort' }

export interface LoopBlockContext {
  /** True when the plan still holds a non-verified milestone the focus could move to. */
  canAdvanceMilestone: boolean
  /** Step-capped runs end on their own step budget and never abort early here. */
  isUnlimitedSteps: boolean
}

/** Manages non-progress budgets, deciding advise/force_advance/stop from PROGRESS_BUDGET. */
export class AgentProgressPolicy {
  private proseReplies = 0
  private stepsWithoutMutation = 0
  private loopBlocks = 0
  private redundantBlocks = 0
  private schemaFailure?: RecoveryFailureState
  private executionFailure?: RecoveryFailureState

  constructor(
    snapshot: ProgressPolicySnapshot = {},
    private readonly budget: ProgressBudget = PROGRESS_BUDGET,
  ) {
    this.schemaFailure = snapshot.schemaFailure
    this.executionFailure = snapshot.executionFailure
  }

  /** Persistable part of the state; streaks restart on resume, failure budgets do not. */
  snapshot(): ProgressPolicySnapshot {
    return { schemaFailure: this.schemaFailure, executionFailure: this.executionFailure }
  }

  get consecutiveLoopBlocks(): number {
    return this.loopBlocks
  }

  get consecutiveRedundantBlocks(): number {
    return this.redundantBlocks
  }

  get schemaRejections(): number {
    return this.schemaFailure?.equivalentFailures || 0
  }

  get schemaFailuresSpent(): number {
    return this.schemaFailure?.totalFailures || 0
  }

  get executionFailuresSpent(): number {
    return this.executionFailure?.totalFailures || 0
  }

  /** A reply without any tool call while work is open: true grants another attempt, false means the budget is spent. */
  tryProseRetry(): boolean {
    if (this.proseReplies >= this.budget.proseReplies) return false
    this.proseReplies++
    return true
  }

  /** A tool call that failed parameter validation, keyed by tool and error signature. */
  onSchemaRejection(signature: string): RecoveryDecision {
    const decision = recordRecoveryFailure(this.schemaFailure, signature)
    this.schemaFailure = decision.state
    return decision
  }

  /** A tool call parsed and validated: prose and schema budgets start over. */
  onToolCallParsed(): void {
    this.proseReplies = 0
    this.schemaFailure = undefined
  }

  /** A parsed call that passed the loop check (and is not `ask`): loop and redundancy streaks start over. */
  onCallAccepted(): void {
    this.loopBlocks = 0
    this.redundantBlocks = 0
  }

  /** A call the loop detector blocked; decides between tolerated redundancy and stagnation escalation. */
  onLoopBlock(repeatOutcome: RepeatOutcomeKind | undefined, context: LoopBlockContext): LoopBlockDecision {
    this.redundantBlocks = repeatOutcome === 'succeeding' ? this.redundantBlocks + 1 : 0
    // Repeating a SUCCESSFUL action is not stagnation: the deliverable exists and the milestone is achievable,
    // so escalating it would mark work FAILED that actually happened. The exemption is bounded.
    if (repeatOutcome === 'succeeding' && this.redundantBlocks <= this.budget.redundantSuccessBlocks) {
      return { kind: 'redundant', redundantBlocks: this.redundantBlocks }
    }

    this.loopBlocks++
    if (context.isUnlimitedSteps && this.loopBlocks >= this.budget.abortLoopBlocks) {
      return { kind: 'stagnation', loopBlocks: this.loopBlocks, escape: 'abort' }
    }
    // Alternating on parity leaves one advisory turn between structural escapes, so the model
    // gets an untouched attempt at the milestone it was just moved onto.
    const advisoryExhausted = this.loopBlocks >= this.budget.advisoryLoopBlocks
    const isEscalationTurn = this.loopBlocks % 2 === 0
    const escape = advisoryExhausted && isEscalationTurn && context.canAdvanceMilestone ? 'force_milestone_advance' : 'advise'
    return { kind: 'stagnation', loopBlocks: this.loopBlocks, escape }
  }

  /**
   * A vague clarification in AUTO mode. It shares the loop-block count on purpose: a model that
   * exhausted a write loop and pivots to asking inherits the same streak.
   */
  tryAskRedirect(): boolean {
    if (this.askRedirectsExhausted()) return false
    this.loopBlocks++
    return true
  }

  /** True once a vague question can no longer be redirected: the model gave up while stuck. */
  askRedirectsExhausted(): boolean {
    return this.loopBlocks >= this.budget.askRedirects
  }

  /** A tool execution that failed and is eligible for the execution budget (one correction, then stop). */
  onExecutionFailure(signature: string): RecoveryDecision {
    const decision = recordRecoveryFailure(this.executionFailure, signature)
    this.executionFailure = decision.state
    return decision
  }

  /** A successful mutation, command or version-conflict resolution proves recovery: the execution budget starts over. */
  clearExecutionFailures(): void {
    this.executionFailure = undefined
  }

  /** Counts executed steps without an effective file change; returns the stopping guard once the budget is spent. */
  onStepExecuted(mutated: boolean): { guard: AgentGuardId; reason: AgentLocalizedText } | null {
    this.stepsWithoutMutation = mutated ? 0 : this.stepsWithoutMutation + 1
    if (this.stepsWithoutMutation < this.budget.stepsWithoutMutation) return null
    return { guard: 'no_mutation', reason: { key: 'reasonNoMutation', params: { steps: this.stepsWithoutMutation } } }
  }
}

/** The closure reason a run gets when it never produced a valid tool call again. */
export function schemaStopReason(toolName: string, rejections: number): AgentLocalizedText {
  return { key: 'reasonSchemaBudget', params: { count: rejections, tool: toolName } }
}
