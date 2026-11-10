import { useCallback, useEffect, useRef, useState } from 'react'
import { documentDraftSnapshotSchema, type DocumentDraft } from '../../shared/domain/documentDraft'
import { errorMessage } from '../../shared/domain/errors/errorMessage'

type Draft = Omit<DocumentDraft, 'docId'>

/** Main owns the archive; memory owns the latest edit until its identical snapshot is acknowledged. */
export function useDocumentDrafts() {
  const draftsRef = useRef(new Map<string, Draft>())
  const [ready, setReady] = useState(false)
  const readyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const revision = useRef('missing')
  const generation = useRef(0)
  const confirmed = useRef(0)
  const chain = useRef<Promise<boolean>>(Promise.resolve(true))
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)
  const loadEpoch = useRef(0)

  const load = useCallback(async () => {
    const epoch = ++loadEpoch.current
    try {
      const snapshot = documentDraftSnapshotSchema.parse(await window.electronAPI!.loadDocumentDrafts())
      if (!mounted.current || epoch !== loadEpoch.current) return
      draftsRef.current = new Map(snapshot.drafts.map(({ docId, ...draft }) => [docId, draft]))
      revision.current = snapshot.revision
      readyRef.current = true
      setReady(true)
      setError(null)
    } catch (failure) {
      if (mounted.current && epoch === loadEpoch.current) setError(errorMessage(failure))
    }
  }, [])

  const flush = useCallback((): Promise<boolean> => {
    const operation = chain.current.then(async () => {
      // A failed bootstrap accepts no edits and must never overwrite the archive.
      if (!readyRef.current) return true
      while (confirmed.current !== generation.current) {
        const version = generation.current
        try {
          const drafts = documentDraftSnapshotSchema.parse({
            revision: revision.current,
            drafts: [...draftsRef.current].map(([docId, draft]) => ({ docId, ...draft })),
          }).drafts
          const saved = documentDraftSnapshotSchema.parse(await window.electronAPI!.saveDocumentDrafts({ revision: revision.current, drafts }))
          if (JSON.stringify(saved.drafts) !== JSON.stringify(drafts)) throw new Error('Draft acknowledgement does not match the submitted edits')
          revision.current = saved.revision
          confirmed.current = version
          if (mounted.current) setError(null)
        } catch (failure) {
          if (mounted.current) setError(errorMessage(failure))
          return false
        }
      }
      return true
    })
    chain.current = operation
    return operation
  }, [])

  const changeDraft = useCallback(
    (docId: string, draft: Draft | null) => {
      if (!readyRef.current) return
      if (draft) draftsRef.current.set(docId, draft)
      else if (!draftsRef.current.delete(docId)) return
      generation.current++
      if (timer.current === null)
        timer.current = setTimeout(() => {
          timer.current = null
          void flush()
        }, 300)
    },
    [flush],
  )

  useEffect(() => {
    mounted.current = true
    void load()
    const bridge = window as Window & { __onlyragFlushDocumentDrafts?: () => Promise<boolean> }
    bridge.__onlyragFlushDocumentDrafts = flush
    return () => {
      mounted.current = false
      loadEpoch.current++
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = null
      if (bridge.__onlyragFlushDocumentDrafts === flush) delete bridge.__onlyragFlushDocumentDrafts
      void flush()
    }
  }, [load, flush])

  return { draftsRef, ready, error, changeDraft, retry: () => (readyRef.current ? flush() : load()) }
}
