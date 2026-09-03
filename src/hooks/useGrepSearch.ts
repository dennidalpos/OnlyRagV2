import { useCallback, useRef, useState } from 'react'
import { GrepSearchResult } from '../types'
import { logger } from '../lib/logger'

/** Workspace-wide text/regex search, backed by the `workspace:grep-search` IPC channel. */
export function useGrepSearch(workspacePath: string | null, isStandaloneMode: boolean) {
  const [grepQuery, setGrepQuery] = useState<string>('')
  const [grepIsRegex, setGrepIsRegex] = useState<boolean>(false)
  const [grepCaseInsensitive, setGrepCaseInsensitive] = useState<boolean>(true)
  const [grepResults, setGrepResults] = useState<GrepSearchResult[]>([])
  const [isSearchingGrep, setIsSearchingGrep] = useState<boolean>(false)
  const searchRequestIdRef = useRef<number>(0)

  const handleRunGrepSearch = useCallback(async () => {
    if (!grepQuery.trim() || !workspacePath || isStandaloneMode || !window.electronAPI?.grepWorkspaceFiles) return
    const requestId = ++searchRequestIdRef.current
    setIsSearchingGrep(true)
    try {
      const matches = await window.electronAPI.grepWorkspaceFiles(workspacePath, grepQuery, grepIsRegex, grepCaseInsensitive)
      if (searchRequestIdRef.current === requestId) {
        setGrepResults(matches || [])
      }
    } catch (err: any) {
      if (searchRequestIdRef.current === requestId) {
        logger.warn('useGrepSearch', `Grep search failed: ${err?.message}`)
      }
    } finally {
      if (searchRequestIdRef.current === requestId) {
        setIsSearchingGrep(false)
      }
    }
  }, [grepQuery, workspacePath, isStandaloneMode, grepIsRegex, grepCaseInsensitive])

  return {
    grepQuery,
    setGrepQuery,
    grepIsRegex,
    setGrepIsRegex,
    grepCaseInsensitive,
    setGrepCaseInsensitive,
    grepResults,
    isSearchingGrep,
    handleRunGrepSearch,
  }
}
