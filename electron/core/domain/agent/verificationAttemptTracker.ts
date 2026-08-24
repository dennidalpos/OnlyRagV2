/**
 * Verification Attempt Tracker.
 *
 * Answers one question from the session's own trajectory: has the project's check already run
 * and failed, with nothing written since?
 *
 * `hasVerifiedBuild` cannot answer it. That flag is false in two entirely different situations
 * — the check has never run, and the check has just failed — and the right next action is
 * opposite in each. The arbiter's `verification_due` state treated them as one, so it kept
 * ordering the check.
 *
 * Measured on 2026-08-24, steps 26 to 34. The model received TWO instructions in the same
 * prompt, from the two channels this project had already been told never to let compete:
 *
 *   plan block  → "Your next tool call MUST be run_command with the command: npm run build."
 *   tool result → "Your next tool call MUST be write_file on src/App.tsx. Do NOT re-run the
 *                  command until you have changed a file."
 *
 * It obeyed the plan block, eight times. Of course it did: that is the strong channel, the one
 * that repeats every turn, and it was built to be obeyed. The diagnostic directive of §5.6e was
 * correct, well placed and single-instruction, and it lost anyway — because the arbiter was
 * contradicting it from the one place that always wins.
 *
 * Pure domain: the caller supplies the episodes.
 */

/** The shape this module needs from a recorded step; matches EpisodicStepRecord. */
export interface TrajectoryStep {
  tool: string
  target?: string
  status: 'SUCCESS' | 'FAILURE' | 'BLOCKED'
}

/** Tools whose success means the workspace changed, so a past failure is no longer current. */
const MUTATING_TOOLS = new Set(['write_file', 'replace_file_content', 'multi_replace_file_content', 'create_directory'])

/**
 * True when the project's own check has run, failed, and nothing has been written since.
 *
 * A successful mutation clears it: the code the check judged no longer exists, so its verdict
 * is stale and running it again is the reasonable next move. A BLOCKED write does not clear it
 * — nothing reached the disk — which is the distinction that keeps a model rewriting the same
 * rejected file from resetting the state forever.
 *
 * `verificationCommand` is matched loosely against the recorded command because the model does
 * not always type it identically (`npm run build` vs `npm run build --silent`), and because a
 * project's check can be reached through more than one spelling.
 */
export function isVerificationFailing(
  episodes: readonly TrajectoryStep[],
  verificationCommand: string | null | undefined
): boolean {
  if (!verificationCommand) return false
  const needle = verificationCommand.trim().toLowerCase()
  if (!needle) return false

  for (let i = (episodes?.length ?? 0) - 1; i >= 0; i--) {
    const step = episodes[i]
    if (step.status === 'SUCCESS' && MUTATING_TOOLS.has(step.tool)) return false
    if (step.tool !== 'run_command') continue
    const command = (step.target || '').trim().toLowerCase()
    if (!command.includes(needle)) continue
    return step.status === 'FAILURE'
  }

  return false
}

/**
 * What the model is told when the check has already run and failed.
 *
 * It says exactly one thing, and deliberately does NOT say what the fix is.
 *
 * The first version did, and got it wrong for the third time in one day: it ordered
 * `write_file` on "the first file the output names", on the same assumption that every
 * compiler error is corrected by editing the file it points at. Measured 2026-08-25, steps
 * 40-48: `TS7016: Could not find a declaration file for module 'react'` — fixed by installing
 * `@types/react`, and the tool result said so, correctly, four times. The plan block said
 * `write_file` instead, and the plan block is the channel that wins. The model rewrote
 * `src/App.tsx` and the same error came back, four times over.
 *
 * The lesson, now applied rather than merely written down: two places must never both prescribe
 * the next action. The diagnostic in the tool output knows what the fix is — it can read the
 * compiler's own suggestion. This directive knows only what the fix is NOT: running the check
 * again. So that is all it says.
 */
export function buildVerificationFailingDirective(verificationCommand: string): string {
  return [
    `[THE PROJECT CHECK ALREADY RAN AND FAILED — DO NOT RUN IT AGAIN YET]`,
    `"${verificationCommand}" has already been executed and reported errors, and nothing has changed since. Running it again will report the same errors: the command reads the code, it does not change it.`,
    `Its output is in your recent tool results above, together with the directive that says exactly what to do about it — which file to write, or which command to run.`,
    `Directives:`,
    `1. Do what that directive says. It is the only instruction that applies right now.`,
    `2. Run "${verificationCommand}" again only after that has actually changed something.`,
  ].join('\n')
}
