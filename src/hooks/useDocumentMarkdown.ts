import { useEffect, useState } from 'react'
import type { IngestedDocument } from '../types'
import { loadDocumentMarkdown, peekDocumentMarkdown } from '../services/documentMarkdown'

interface LoadedMarkdown {
  key: string
  markdown: string | null
}

/**
 * Markdown of the given document version, loaded on demand (the document list carries metadata
 * only). `markdown` is null while loading or when the load failed; it never belongs to another document.
 */
export function useDocumentMarkdown(doc: Pick<IngestedDocument, 'id' | 'ingestedAt'> | null) {
  const docId = doc?.id
  const version = doc?.ingestedAt ?? ''
  const key = docId ? `${docId}@${version}` : null
  const [loaded, setLoaded] = useState<LoadedMarkdown | null>(null)

  useEffect(() => {
    if (!docId) return
    const target = { id: docId, ingestedAt: version }
    if (peekDocumentMarkdown(target) !== undefined) return
    let cancelled = false
    loadDocumentMarkdown(target).then((markdown) => {
      if (!cancelled) setLoaded({ key: `${docId}@${version}`, markdown })
    })
    return () => {
      cancelled = true
    }
  }, [docId, version])

  if (!docId || !key) return { markdown: null, isLoading: false, loadFailed: false }
  const cached = peekDocumentMarkdown({ id: docId, ingestedAt: version })
  if (cached !== undefined) return { markdown: cached, isLoading: false, loadFailed: false }
  const settled = loaded?.key === key ? loaded : null
  return { markdown: settled?.markdown ?? null, isLoading: !settled, loadFailed: Boolean(settled && settled.markdown === null) }
}
