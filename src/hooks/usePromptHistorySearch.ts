import { useCallback, useEffect, useRef, useState } from 'react'
import { PromptHistorySearchResult } from '../types'
import { logger } from '../lib/logger'
import { errorMessage } from '../../shared/domain/errors/errorMessage'

/** Owns the cross-project prompt history search modal's query/results state. */
export function usePromptHistorySearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PromptHistorySearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const revision = useRef(0)
  useEffect(
    () => () => {
      revision.current += 1
    },
    [],
  )

  const search = useCallback(async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) return
    const request = ++revision.current
    setIsSearching(true)
    setError(null)
    setResults([])
    setHasSearched(false)
    try {
      if (!window.electronAPI?.searchPromptHistory) throw new Error('Prompt history search unavailable')
      const res = await window.electronAPI.searchPromptHistory({ query: trimmed, topK: 15 })
      if (request !== revision.current) return
      if (!Array.isArray(res)) throw new Error('Invalid prompt history search response')
      setResults(res)
      setHasSearched(true)
    } catch (err: unknown) {
      if (request !== revision.current) return
      logger.warn('usePromptHistorySearch', `Search failed: ${errorMessage(err)}`)
      setError(errorMessage(err) || 'Search failed')
      setResults([])
    } finally {
      if (request === revision.current) setIsSearching(false)
    }
  }, [])

  const reset = useCallback(() => {
    revision.current += 1
    setIsSearching(false)
    setQuery('')
    setResults([])
    setError(null)
    setHasSearched(false)
  }, [])

  return { query, setQuery, results, isSearching, error, hasSearched, search, reset }
}
