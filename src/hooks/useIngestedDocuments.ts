import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { IngestedDocument } from '../types'
import { apiService } from '../services/api'
import { logger } from '../lib/logger'
import { nextRetryDelayMs, shouldReportFailure, DEFAULT_RETRY_POLICY } from '../lib/pollingRetryPolicy'
import { createSingleFlight } from '../lib/singleFlight'

// Every mounted consumer of this hook keeps its own copy of the list and its own callbacks,
// but they all read the same backend collection -- and a single documents-changed or focus
// event reaches all of them at once. Sharing the in-flight request turns that fan-out back into
// one IPC round-trip; the per-instance state each consumer needs is unaffected.
const fetchDocumentsShared = createSingleFlight(() => apiService.getIngestedDocuments())

export const DOCUMENTS_CHANGED_EVENT = 'onlyrag:documents-changed'
export const TAB_CHANGED_EVENT = 'onlyrag:tab-changed'

/**
 * Global helper to notify all modules and active views of document database mutations
 */
export function notifyDocumentsChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(DOCUMENTS_CHANGED_EVENT))
  } catch (err: any) {
    logger.warn('useIngestedDocuments', `Failed to dispatch documents-changed event: ${err.message}`)
  }
}

/**
 * Global helper to notify active views of navigation tab changes
 */
export function notifyTabChanged(newTab: string): void {
  try {
    window.dispatchEvent(new CustomEvent(TAB_CHANGED_EVENT, { detail: { tab: newTab } }))
  } catch (err: any) {
    logger.warn('useIngestedDocuments', `Failed to dispatch tab-changed event: ${err.message}`)
  }
}

export interface UseIngestedDocumentsOptions {
  onDocsUpdated?: (docs: IngestedDocument[]) => void
  /** Delay before the first retry. Later retries back off exponentially from here. */
  retryBaseDelayMs?: number
}

export function useIngestedDocuments(options: UseIngestedDocumentsOptions = {}) {
  const { onDocsUpdated, retryBaseDelayMs = DEFAULT_RETRY_POLICY.baseDelayMs } = options
  const [documents, setDocuments] = useState<IngestedDocument[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [isLoaded, setIsLoaded] = useState<boolean>(false)
  
  const onDocsUpdatedRef = useRef(onDocsUpdated)
  useEffect(() => {
    onDocsUpdatedRef.current = onDocsUpdated
  }, [onDocsUpdated])

  const isLoadedRef = useRef(false)
  useEffect(() => {
    isLoadedRef.current = isLoaded
  }, [isLoaded])

  const isFetchingRef = useRef(false)

  const retryPolicy = useMemo(
    () => ({ ...DEFAULT_RETRY_POLICY, baseDelayMs: retryBaseDelayMs }),
    [retryBaseDelayMs]
  )

  // Consecutive failed fetches of the current outage. Drives both the retry backoff and the log
  // throttling, and resets to 0 the moment the sidecar answers again.
  const consecutiveFailuresRef = useRef(0)

  const reportFailure = useCallback(
    (reason: string) => {
      consecutiveFailuresRef.current += 1
      const failures = consecutiveFailuresRef.current
      if (shouldReportFailure(failures)) {
        logger.warn(
          'useIngestedDocuments',
          `Document list unavailable (${reason}); keeping the previous list and selection. ` +
            `Failed attempts so far: ${failures}; retrying in ${nextRetryDelayMs(failures, retryPolicy)} ms.`
        )
      }
    },
    [retryPolicy]
  )

  const fetchDocuments = useCallback(async () => {
    if (isFetchingRef.current) return
    isFetchingRef.current = true
    setIsLoading(true)
    try {
      const docs = await fetchDocumentsShared()
      if (docs === null) {
        // Could not ask the sidecar. Keep the documents (and the caller's selection built on
        // them) exactly as they were, and leave isLoaded false so the retry timer keeps going.
        reportFailure('sidecar unreachable')
        return
      }
      if (consecutiveFailuresRef.current > 0) {
        logger.info(
          'useIngestedDocuments',
          `Document list recovered after ${consecutiveFailuresRef.current} failed attempts.`
        )
        consecutiveFailuresRef.current = 0
      }
      setDocuments(docs)
      isLoadedRef.current = true
      setIsLoaded(true)
      if (onDocsUpdatedRef.current) {
        onDocsUpdatedRef.current(docs)
      }
    } catch (err: any) {
      reportFailure(err?.message || 'unknown error')
    } finally {
      setIsLoading(false)
      isFetchingRef.current = false
    }
  }, [reportFailure])

  useEffect(() => {
    fetchDocuments()

    const handleSyncEvent = () => {
      fetchDocuments()
    }

    window.addEventListener(DOCUMENTS_CHANGED_EVENT, handleSyncEvent)
    window.addEventListener(TAB_CHANGED_EVENT, handleSyncEvent)
    window.addEventListener('focus', handleSyncEvent)

    // Auto-retry polling only until the first fetch resolves (bridges the sidecar startup delay).
    // Gated on isLoadedRef rather than document count, so polling stops for good once the initial
    // load succeeds -- even if the resulting list is legitimately empty -- instead of continuing
    // to hit the sidecar for the entire session.
    //
    // Self-scheduling timeout rather than a fixed interval: a sidecar that never comes up must
    // cost a backing-off trickle of attempts, not one every retryBaseDelayMs forever.
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let cancelled = false

    const scheduleRetry = () => {
      if (cancelled || isLoadedRef.current) return
      const delay = nextRetryDelayMs(consecutiveFailuresRef.current, retryPolicy)
      retryTimer = setTimeout(async () => {
        if (cancelled || isLoadedRef.current) return
        await fetchDocuments()
        scheduleRetry()
      }, delay)
    }
    scheduleRetry()

    return () => {
      cancelled = true
      window.removeEventListener(DOCUMENTS_CHANGED_EVENT, handleSyncEvent)
      window.removeEventListener(TAB_CHANGED_EVENT, handleSyncEvent)
      window.removeEventListener('focus', handleSyncEvent)
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [fetchDocuments, retryPolicy])

  return {
    documents,
    isLoading,
    isLoaded,
    refetchDocuments: fetchDocuments,
    setDocuments,
  }
}
