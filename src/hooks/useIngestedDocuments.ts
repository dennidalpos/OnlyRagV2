import { useState, useEffect, useCallback, useRef } from 'react'
import { IngestedDocument } from '../types'
import { apiService } from '../services/api'
import { logger } from '../lib/logger'

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
  autoRetryIntervalMs?: number
}

export function useIngestedDocuments(options: UseIngestedDocumentsOptions = {}) {
  const { onDocsUpdated, autoRetryIntervalMs = 3000 } = options
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

  const fetchDocuments = useCallback(async () => {
    if (isFetchingRef.current) return
    isFetchingRef.current = true
    setIsLoading(true)
    try {
      const docs = await apiService.getIngestedDocuments()
      const validDocs = Array.isArray(docs) ? docs : []
      setDocuments(validDocs)
      setIsLoaded(true)
      if (onDocsUpdatedRef.current) {
        onDocsUpdatedRef.current(validDocs)
      }
    } catch (err: any) {
      logger.error('useIngestedDocuments', `Failed fetching documents: ${err.message}`)
    } finally {
      setIsLoading(false)
      isFetchingRef.current = false
    }
  }, [])

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
    // to hit the sidecar every autoRetryIntervalMs for the entire session.
    const timer = setInterval(() => {
      if (!isLoadedRef.current) {
        fetchDocuments()
      }
    }, autoRetryIntervalMs)

    return () => {
      window.removeEventListener(DOCUMENTS_CHANGED_EVENT, handleSyncEvent)
      window.removeEventListener(TAB_CHANGED_EVENT, handleSyncEvent)
      window.removeEventListener('focus', handleSyncEvent)
      clearInterval(timer)
    }
  }, [fetchDocuments, autoRetryIntervalMs])

  return {
    documents,
    isLoading,
    isLoaded,
    refetchDocuments: fetchDocuments,
    setDocuments,
  }
}
