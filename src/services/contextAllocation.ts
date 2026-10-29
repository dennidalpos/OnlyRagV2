export type ContextAllocationStatus = 'matched' | 'underallocated' | 'unknown'

/**
 * Compares the requested context with Ollama's observed allocation.
 * `/api/ps` is a verification signal after dispatch, never an input to sizing decisions.
 */
export function compareContextAllocation(requested?: number, allocated?: number): ContextAllocationStatus {
  if (!Number.isFinite(requested) || !Number.isFinite(allocated) || requested === undefined || allocated === undefined) {
    return 'unknown'
  }
  return allocated >= requested ? 'matched' : 'underallocated'
}
