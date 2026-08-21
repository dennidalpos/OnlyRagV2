/**
 * electron/core/domain/agent/agentExecutionGuard.ts
 *
 * Domain Layer — Unified Execution Guard, Loop Detection & Circuit Breaker Engine.
 * Single entry point coordinating:
 *  1. Action Loop & Cycle Oscillation Detection (AgentActionLoopDetector)
 *  2. Stagnation & Failure Circuit Breaker (StagnationCircuitBreaker)
 *  3. Definition of Done & State Verification (TransactionalExecutionGuard)
 */

import { AgentActionLoopDetector, type LoopCheckResult } from './loopDetector'
import { StagnationCircuitBreaker, type CircuitBreakerResult } from './stagnationCircuitBreaker'
import {
  TransactionalExecutionGuard,
  type VerificationRequirement,
  type ExecutionGuardCheckResult,
} from './transactionalExecutionGuard'
import type { AgentToolCall } from './agentTypes'

export interface AgentExecutionGuardOptions {
  workspaceRoot?: string
  maxRepeatsAllowed?: number
  maxNoMutationSteps?: number
  maxFailureSteps?: number
}

export class AgentExecutionGuard {
  public readonly loopDetector: AgentActionLoopDetector
  public readonly circuitBreaker: StagnationCircuitBreaker
  public readonly transactionalGuard: TransactionalExecutionGuard

  constructor(options: AgentExecutionGuardOptions = {}) {
    this.loopDetector = new AgentActionLoopDetector(options.maxRepeatsAllowed ?? 2)
    this.circuitBreaker = new StagnationCircuitBreaker(
      options.maxNoMutationSteps ?? 8,
      options.maxFailureSteps ?? 4
    )
    this.transactionalGuard = new TransactionalExecutionGuard(
      options.workspaceRoot || process.cwd()
    )
  }

  /**
   * Checks tool call for exact fingerprint repeats, cycle oscillations,
   * shell-tool keyword confusions, and read thrashes.
   */
  public checkLoop(toolCall: AgentToolCall): LoopCheckResult {
    return this.loopDetector.recordAndCheck(toolCall)
  }

  /**
   * Records step outcome for stagnation and repeated failure monitoring.
   */
  public checkStagnation(isMutatingTool: boolean, isFailure: boolean): CircuitBreakerResult {
    return this.circuitBreaker.recordStep(isMutatingTool, isFailure)
  }

  /**
   * Validates Definition of Done (DoD) before task completion.
   */
  public validateTaskCompletion(req: VerificationRequirement): ExecutionGuardCheckResult {
    return this.transactionalGuard.validateTaskCompletion(req)
  }

  /**
   * Resets internal tracking state.
   */
  public reset(): void {
    this.loopDetector.reset()
    this.circuitBreaker.reset()
  }
}
