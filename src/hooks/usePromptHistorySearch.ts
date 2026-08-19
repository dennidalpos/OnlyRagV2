import { useCallback, useState } from 'react'
import { PromptHistorySearchResult } from '../types'
import { logger } from '../lib/logger'

/** Owns the cross-project prompt history search modal's query/results state. */
export function usePromptHistorySearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PromptHistorySearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)

  const search = useCallback(async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed || !window.electronAPI?.searchPromptHistory) return
    setIsSearching(true)
    setError(null)
    try {
      const res = await window.electronAPI.searchPromptHistory(trimmed, 15)
      setResults(res || [])
      setHasSearched(true)
    } catch (err: any) {
      logger.warn('usePromptHistorySearch', `Search failed: ${err?.message}`)
      setError(err?.message || 'Search failed')
      setResults([])
    } finally {
      setIsSearching(false)
    }
  }, [])

  const reset = useCallback(() => {
    setQuery('')
    setResults([])
    setError(null)
    setHasSearched(false)
  }, [])

  return { query, setQuery, results, isSearching, error, hasSearched, search, reset }
}
