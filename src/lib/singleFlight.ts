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
