import type { AgentGuardId } from '../../../../shared/types'
import type { RepeatOutcomeKind } from './loopDetector'
import { recordRecoveryFailure, type RecoveryDecision, type RecoveryFailureState } from './recoveryBudget'

/**
 * Every non-progress threshold of an agent run, in one table. The values are model-agnostic:
 * they bound how long any model may stay without progress, not how a specific model behaves.
 */
export const PROGRESS_BUDGET = {
  /** Prose-only replies answered with a request for a tool call while operational work is open. */
  proseReplies: 2,
  /** Executed steps without an effective file change before the run stops (`no_mutation`). */
  stepsWithoutMutation: 12,
  /** Loop blocks answered with advice alone; afterwards every second block may move the plan focus. */
  advisoryLoopBlocks: 2,
  /** Loop blocks after which a run without a step budget stops (`stagnation_abort`). */
  abortLoopBlocks: 20,
  /** Blocks of an action that SUCCEEDED before, treated as redundancy rather than stagnation. */
  redundantSuccessBlocks: 3,
  /** Vague clarification questions redirected back to work in AUTO mode (shares the loop-block count). */
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

/**
 * Single progress policy of an agent run: it owns the counters that used to live in the loop
 * escape policy, the stagnation circuit breaker, the rejection escalation and the per-category
 * recovery budgets, and decides advise / re-plan / stop from one budget table. Pattern
 * detection (which repeat is a loop) stays in AgentActionLoopDetector; this class only decides
 * what a detected non-progress event costs.
 */
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
  onStepExecuted(mutated: boolean): { guard: AgentGuardId; reason: string } | null {
    this.stepsWithoutMutation = mutated ? 0 : this.stepsWithoutMutation + 1
    if (this.stepsWithoutMutation < this.budget.stepsWithoutMutation) return null
    return {
      guard: 'no_mutation',
      reason: `No-mutation stagnation streak limit reached (${this.stepsWithoutMutation} read/inspect steps without file changes).`,
    }
  }
}

/** The summary a run gets when it never produced a valid tool call again. */
export function schemaStopSummary(toolName: string, rejections: number): string {
  return (
    `Sessione interrotta: ${rejections} chiamate consecutive a "${toolName}" sono state rifiutate dalla validazione dei parametri ` +
    `e nessuna e' mai stata eseguita. Il contratto del tool e' stato inviato al modello a ogni tentativo. ` +
    `Nessuna modifica e' stata persa: i file scritti prima di questa serie restano sul disco.`
  )
}
