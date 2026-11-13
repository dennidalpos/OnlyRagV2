import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '../../shared/domain/errors/errorMessage'

/**
 * Git working-tree status and unified diff of the active workspace, read through
 * the native Git CLI IPC channel (clean UTF-8, ANSI-free, proper untracked file handling).
 *
 * Only the latest read of the current workspace may update the state: a generation changes on every
 * workspace switch and unmount, and each read carries a token, so late responses, errors and
 * loading resets of an earlier workspace or an earlier refresh are ignored.
 */
export function useGitStatus(workspacePath: string | null) {
  const [gitStatusLines, setGitStatusLines] = useState<string[]>([])
  const [gitDiffText, setGitDiffText] = useState<string>('')
  const [isGitRepo, setIsGitRepo] = useState<boolean>(true)
  const [isFetchingGit, setIsFetchingGit] = useState<boolean>(false)
  /** Workspace the displayed status and diff were read from; null until a read of the current workspace applies. */
  const [gitDataWorkspace, setGitDataWorkspace] = useState<string | null>(null)

  const generationRef = useRef(0)
  const readRef = useRef(0)

  useEffect(() => {
    setGitStatusLines([])
    setGitDiffText('')
    setIsGitRepo(true)
    setGitDataWorkspace(null)
    setIsFetchingGit(false)
    return () => {
      generationRef.current += 1
    }
  }, [workspacePath])

  const fetchGitStatusAndDiff = useCallback(async () => {
    if (!window.electronAPI) return
    const generation = generationRef.current
    const token = ++readRef.current
    const ownsRead = () => generation === generationRef.current && token === readRef.current
    setIsFetchingGit(true)
    try {
      if (window.electronAPI.getGitStatusAndDiff) {
        const res = await window.electronAPI.getGitStatusAndDiff({ workspaceRoot: workspacePath || undefined })
        if (!ownsRead()) return
        setIsGitRepo(res.isGitRepo)
        setGitStatusLines(res.statusLines || [])
        setGitDiffText(res.diffText || '')
      } else {
        if (!ownsRead()) return
        setIsGitRepo(false)
        setGitStatusLines([])
        setGitDiffText('')
      }
      setGitDataWorkspace(workspacePath)
    } catch (err: unknown) {
      if (!ownsRead()) return
      setIsGitRepo(false)
      setGitStatusLines([])
      setGitDiffText(`Git error: ${errorMessage(err) || String(err)}`)
      setGitDataWorkspace(workspacePath)
    } finally {
      if (ownsRead()) setIsFetchingGit(false)
    }
  }, [workspacePath])

  const initGit = useCallback(async () => {
    if (!window.electronAPI?.initGitRepository) return
    const generation = generationRef.current
    const token = ++readRef.current
    const ownsRead = () => generation === generationRef.current && token === readRef.current
    setIsFetchingGit(true)
    try {
      const result = await window.electronAPI.initGitRepository({ workspaceRoot: workspacePath || undefined })
      if (!ownsRead()) return
      if (!result.success) {
        setGitDiffText(`Git error: ${result.message}`)
        return
      }
      await fetchGitStatusAndDiff()
    } catch (err: unknown) {
      if (!ownsRead()) return
      setGitDiffText(`Git error: ${errorMessage(err) || String(err)}`)
    } finally {
      if (ownsRead()) setIsFetchingGit(false)
    }
  }, [workspacePath, fetchGitStatusAndDiff])

  return { gitStatusLines, gitDiffText, isGitRepo, isFetchingGit, gitDataWorkspace, fetchGitStatusAndDiff, initGit }
}
