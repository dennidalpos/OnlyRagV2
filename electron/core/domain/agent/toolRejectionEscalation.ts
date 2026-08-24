/**
 * Tool Rejection Escalation.
 *
 * What to do when the model keeps emitting a tool call the schema validator refuses.
 *
 * The path had no ladder at all, and no terminating guarantee. `handleMissingToolCall` recorded
 * the rejection, sent back the tool's contract and returned `continue` — without incrementing
 * any counter. The loop detector never sees these calls, because a call that fails validation
 * never reaches it: in the live run of 2026-08-24 the audit log contains ZERO
 * `LOOP INTERVENTION PREVENTED` entries while the model spent steps 18 through 50 — thirty-three
 * consecutive turns — re-emitting `replace_file_content` without its `replacementContent`. The
 * session did not stop because a guard stopped it; it stopped because it ran out of steps.
 *
 * The correction directive itself is not the problem and is not what changes here. It is
 * correct, complete and specific — it names the tool, the mandatory parameters and the exact
 * JSON envelope, and it was sent 97 times. Sending it a 98th time is not the answer, which is
 * the same lesson `loopEscapePolicy.ts` records for its own ladder: advisory text first, then a
 * change of state, then a stop.
 *
 * What replaces it above the threshold is a DIFFERENT action, not a sterner version of the same
 * one: `write_file` with the whole file body. It is the simplest mutation the catalogue offers,
 * it is always available, and it needs no exact-match parameter — which is the part the model
 * demonstrably cannot produce.
 *
 * Pure domain: the caller supplies the streak.
 */

export type ToolRejectionAction =
  /** Send the tool's contract back and let the model try again. */
  | 'correct'
  /** Stop asking for that tool: name a simpler one the model can actually emit. */
  | 'switch_tool'
  /** The model has not produced a valid call in a long time; end the session honestly. */
  | 'abort'

/**
 * Rejections answered with the contract alone before the directive changes.
 *
 * Two, matching `LOOP_ESCAPE_ADVISORY_ATTEMPTS`: a model that can read the schema and fix its
 * call does so immediately, and one that cannot will not start on the third attempt.
 */
export const REJECTION_CORRECTION_ATTEMPTS = 2

/**
 * Consecutive rejections after which the session stops rather than spending its remaining
 * budget on a call that has never once validated.
 *
 * Well below the thirty-three observed: past this point every additional turn is a model
 * re-emitting a shape it has been shown, in full, eight times.
 */
export const REJECTION_ABORT_STREAK = 8

export function resolveToolRejectionAction(rejectionStreak: number): ToolRejectionAction {
  if (rejectionStreak >= REJECTION_ABORT_STREAK) return 'abort'
  if (rejectionStreak > REJECTION_CORRECTION_ATTEMPTS) return 'switch_tool'
  return 'correct'
}

/**
 * The directive that replaces the schema contract once repeating it has demonstrably failed.
 *
 * One instruction, one tool, and it says explicitly to stop using the one being rejected —
 * otherwise the model reads it as an additional option and keeps the failing call in play.
 * The reason is stated because a model told only "do something else" picks anything.
 */
export function buildToolSwitchDirective(toolName: string, rejectionStreak: number): string {
  return [
    `[STOP USING "${toolName}" — IT HAS BEEN REJECTED ${rejectionStreak} TIMES IN A ROW]`,
    `Every attempt has been refused before it ran, so nothing you intended has been written. The exact contract for "${toolName}" is already in your recent tool outputs and re-reading it has not helped.`,
    `"write_file" needs no exact-match parameter: you give it a path and the COMPLETE new body of the file, and it replaces what is there.`,
    `Directives:`,
    `1. Your next tool call MUST be "write_file", with "filePath" and the full "content" of the file you were trying to edit.`,
    `2. Do NOT emit "${toolName}" again in this session.`,
  ].join('\n')
}

/** The summary a session gets when it never produced a valid tool call again. */
export function rejectionAbortSummary(toolName: string, rejectionStreak: number): string {
  return (
    `Sessione interrotta: ${rejectionStreak} chiamate consecutive a "${toolName}" sono state rifiutate dalla validazione dei parametri ` +
    `e nessuna e' mai stata eseguita. Il contratto del tool e' stato inviato al modello a ogni tentativo. ` +
    `Nessuna modifica e' stata persa: i file scritti prima di questa serie restano sul disco.`
  )
}
