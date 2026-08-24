import { useCallback, useState } from 'react'

/**
 * Git working-tree status and unified diff of the active workspace, read through
 * the native Git CLI IPC channel (clean UTF-8, ANSI-free, proper untracked file handling).
 */
export function useGitStatus(workspacePath: string | null) {
  const [gitStatusLines, setGitStatusLines] = useState<string[]>([])
  const [gitDiffText, setGitDiffText] = useState<string>('')
  const [isGitRepo, setIsGitRepo] = useState<boolean>(true)
  const [isFetchingGit, setIsFetchingGit] = useState<boolean>(false)

  const fetchGitStatusAndDiff = useCallback(async () => {
    if (!window.electronAPI) return
    setIsFetchingGit(true)
    try {
      if (window.electronAPI.getGitStatusAndDiff) {
        const res = await window.electronAPI.getGitStatusAndDiff(workspacePath || undefined)
        setIsGitRepo(res.isGitRepo)
        setGitStatusLines(res.statusLines || [])
        setGitDiffText(res.diffText || '')
      } else {
        setIsGitRepo(false)
        setGitStatusLines([])
        setGitDiffText('')
      }
    } catch (err: any) {
      setIsGitRepo(false)
      setGitStatusLines([])
      setGitDiffText(`Git error: ${err.message || String(err)}`)
    } finally {
      setIsFetchingGit(false)
    }
  }, [workspacePath])

  const initGit = useCallback(async () => {
    if (!window.electronAPI?.initGitRepository) return
    setIsFetchingGit(true)
    try {
      await window.electronAPI.initGitRepository(workspacePath || undefined)
      await fetchGitStatusAndDiff()
    } finally {
      setIsFetchingGit(false)
    }
  }, [workspacePath, fetchGitStatusAndDiff])

  return { gitStatusLines, gitDiffText, isGitRepo, isFetchingGit, fetchGitStatusAndDiff, initGit }
}
