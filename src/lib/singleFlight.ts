/**
 * Collapses concurrent calls of one async operation into a single in-flight execution.
 *
 * Several independently-mounted hooks can ask for the same backend list at the same instant —
 * a `documents-changed` event fans out to every consumer at once — and each ask used to become
 * its own IPC round-trip for identical data. Callers that arrive while a call is in flight now
 * await that call instead of starting another.
 *
 * Deliberately not a cache: once the call settles the next caller starts a fresh one, so this
 * never serves stale data. It only removes duplicate work that is already happening.
 */
export function createSingleFlight<T>(operation: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null

  return () => {
    if (inFlight) return inFlight

    // Settling is cleared in a `finally` on the shared promise rather than after the await, so
    // a rejection releases the slot too instead of wedging every later caller on a dead promise.
    inFlight = operation().finally(() => {
      inFlight = null
    })

    return inFlight
  }
}
