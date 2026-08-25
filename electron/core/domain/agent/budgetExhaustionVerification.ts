/**
 * Budget Exhaustion Verification.
 *
 * Decides whether the session's LAST exit should run the project's own verification.
 *
 * A session has two ways out and only one of them ever verified anything. `finish` runs
 * `runProjectVerification`, hands a failure back for correction, and on a pass calls
 * `promoteMilestonesProvenBy` — see agentOrchestratorFinishAndLoopGuards.ts. Falling out of the
 * step budget went straight to `emitDone`, so a run that delivered every file its plan named
 * and simply never spent a step on `finish` closed with nothing verified and no check ever
 * attempted, while the machinery to attempt it sat one call away.
 *
 * Measured, live-full-task 2026-08-25T12:11 (qwen2.5-coder:7b, 50/50 steps): twelve files
 * written, all fourteen milestones holding
 * `AWAITING_VERIFICATION_MARKER`, and in the whole session zero `-> VERIFIED` transitions,
 * zero promotion log lines, and zero `update_plan` refusals for missing deliverables — the
 * model never once asked for `verified`, so `milestoneUpdateAuthority` never refused anything.
 * All twelve `run_command` calls were `npm install`; `finish` was never invoked. The promotion
 * path was correct throughout and was called zero times, because nothing calls it here.
 *
 * The criterion the blueprint states in §6.2.3 is unchanged and deliberately so: a milestone
 * reaches `verified` only when its declared files are really on disk AND a real check really
 * passed. This module does not weaken that test, it supplies the one exit that never applied
 * it.
 *
 * Pure domain: running the command and probing the workspace belongs to the caller.
 */

export interface BudgetExhaustionVerificationInput {
  /** The loop stopped because the step budget ran out, not because of finish, cancel or error. */
  budgetExhausted: boolean
  /**
   * The session is still live. A cancelled or torn-down session must not have a build started
   * on its behalf: cleanupSession has already killed its shell and rolled back its journal.
   */
  sessionActive: boolean
  /** There is a workspace to verify. Standalone (chat-only) sessions have none. */
  hasWorkspace: boolean
  /** `verifyBeforeFinish`, as the finish gate reads it. A project that opted out opts out here too. */
  verifyBeforeFinish: boolean
  /** Something was written this session; with nothing on disk there is nothing to prove. */
  hasFileMutations: boolean
  /** A verification already passed and nothing has been written since. */
  hasVerifiedBuild: boolean
  /**
   * How many milestones a passing check would actually promote — deliverables present, not
   * already verified, not abandoned, not the completion one.
   */
  promotableMilestoneCount: number
}

/**
 * Whether to spend one last command on the project's own check.
 *
 * `promotableMilestoneCount` is the gate that keeps this cheap. Verification can take minutes
 * on a cold `npm run build`, and running it at the end of every exhausted session would charge
 * that to runs it cannot help: one whose plan is already fully verified, and one whose
 * milestones are all still missing their files. Only a plan holding milestones that a pass
 * WOULD promote is worth the wait, and that is precisely the state the live run ended in.
 */
export function shouldVerifyOnBudgetExhaustion(input: BudgetExhaustionVerificationInput): boolean {
  return (
    input.budgetExhausted &&
    input.sessionActive &&
    input.hasWorkspace &&
    input.verifyBeforeFinish &&
    input.hasFileMutations &&
    !input.hasVerifiedBuild &&
    input.promotableMilestoneCount > 0
  )
}

/** What the terminal check ended up establishing, for the session summary. */
export type BudgetExhaustionOutcome =
  /** No check was run: `shouldVerifyOnBudgetExhaustion` said no. */
  | { kind: 'not_attempted' }
  /** The project offers no command able to prove it works. */
  | { kind: 'no_command' }
  | { kind: 'passed'; command: string; promoted: number }
  | { kind: 'failed'; command: string }

/**
 * The session summary shown to the user when the step budget runs out.
 *
 * It says what the run PROVED, not only that it stopped. The previous text — "Raggiunto il
 * limite massimo di passaggi configurato (50 step)." — is identical for a run that delivered a
 * building project and one that delivered nothing, which is the same indistinguishability
 * `decideVerificationGate` refuses to allow at the `finish` exit.
 */
export function budgetExhaustionSummary(maxSteps: number, outcome: BudgetExhaustionOutcome): string {
  const base = `Raggiunto il limite massimo di passaggi configurato (${maxSteps} step).`

  switch (outcome.kind) {
    case 'passed':
      return `${base} Verifica finale "${outcome.command}" superata: ${outcome.promoted} milestone promosse a verified.`
    case 'failed':
      return `${base} Verifica finale "${outcome.command}" fallita: il progetto sul disco non è stato dimostrato funzionante.`
    case 'no_command':
      return `${base} Nessun comando di verifica ricavabile dal progetto: il risultato non è stato dimostrato funzionante.`
    default:
      return base
  }
}
