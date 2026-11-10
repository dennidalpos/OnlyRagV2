import { useCallback, useEffect, useRef, useState } from 'react'
import type { IngestedDocument } from '../../types'
import { useIngestedDocuments } from '../useIngestedDocuments'

/** RAG documents attached to the next agent run; ids that disappear from the store or from disk are dropped. */
export function useCodingAgentAttachments() {
  const [attachedDocIds, setAttachedDocIds] = useState<Set<string>>(new Set())

  const handleDocsUpdated = useCallback((docs: IngestedDocument[]) => {
    const validIds = new Set(docs.map((d) => d.id))
    setAttachedDocIds((prev) => new Set([...prev].filter((id) => validIds.has(id))))
  }, [])

  const { documents: ingestedDocs } = useIngestedDocuments({ onDocsUpdated: handleDocsUpdated })

  const ingestedDocsRef = useRef(ingestedDocs)
  useEffect(() => {
    ingestedDocsRef.current = ingestedDocs
  }, [ingestedDocs])

  /** Passed to useWorkspaceFiles: detaches documents whose source file lies inside a deleted path. */
  const handlePathPurged = useCallback((isInsideDeletedPath: (filePath: string) => boolean) => {
    setAttachedDocIds((prev) => {
      const next = new Set(prev)
      for (const docId of next) {
        const doc = ingestedDocsRef.current.find((d) => d.id === docId)
        if (doc?.filePath && isInsideDeletedPath(doc.filePath)) next.delete(docId)
      }
      return next
    })
  }, [])

  const toggleAttachDoc = useCallback((docId: string) => {
    setAttachedDocIds((prev) => {
      const next = new Set(prev)
      if (next.has(docId)) next.delete(docId)
      else next.add(docId)
      return next
    })
  }, [])

  const clearAttachedDocs = useCallback(() => setAttachedDocIds(new Set()), [])

  return { ingestedDocs, attachedDocIds, toggleAttachDoc, clearAttachedDocs, handlePathPurged }
}
