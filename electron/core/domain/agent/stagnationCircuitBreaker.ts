export interface CircuitBreakerResult {
  shouldBreak: boolean
  stagnationStreak: number
  reason?: string
  suggestedAction?: string
}

/**
 * Stagnation Circuit Breaker: Prevents runaway step loops (e.g. 300+ steps) on minimal hardware
 * by detecting stagnation streaks and forcing milestone checkpoints or task pause.
 */
export class StagnationCircuitBreaker {
  private noMutationStreak = 0
  private repeatedFailureStreak = 0
  private readonly maxNoMutationSteps: number
  private readonly maxFailureSteps: number

  constructor(maxNoMutationSteps = 8, maxFailureSteps = 4) {
    this.maxNoMutationSteps = maxNoMutationSteps
    this.maxFailureSteps = maxFailureSteps
  }

  public recordStep(isMutatingTool: boolean, isFailure: boolean): CircuitBreakerResult {
    if (isMutatingTool) {
      this.noMutationStreak = 0
    } else {
      this.noMutationStreak++
    }

    if (isFailure) {
      this.repeatedFailureStreak++
    } else {
      this.repeatedFailureStreak = 0
    }

    if (this.noMutationStreak >= this.maxNoMutationSteps) {
      return {
        shouldBreak: true,
        stagnationStreak: this.noMutationStreak,
        reason: `No-mutation stagnation streak limit reached (${this.noMutationStreak} read/inspect steps without file changes).`,
        suggestedAction: 'Forcing execution pause. Proceed immediately to applying file changes or call finish tool.',
      }
    }

    if (this.repeatedFailureStreak >= this.maxFailureSteps) {
      return {
        shouldBreak: true,
        stagnationStreak: this.repeatedFailureStreak,
        reason: `Repeated tool failure limit reached (${this.repeatedFailureStreak} consecutive failures).`,
        suggestedAction: 'Forcing execution pause to prevent runaway loop. Ask user for clarification or inspect stack trace.',
      }
    }

    return { shouldBreak: false, stagnationStreak: Math.max(this.noMutationStreak, this.repeatedFailureStreak) }
  }

  public reset(): void {
    this.noMutationStreak = 0
    this.repeatedFailureStreak = 0
  }
}
