import { useCallback, useState } from 'react'

const GIT_SPLIT_MARKER = '---GIT_DIFF_SPLIT---'

/**
 * Git working-tree status and unified diff of the active workspace, read through the
 * single PowerShell IPC channel so status and diff always describe the same snapshot.
 */
export function useGitStatus(workspacePath: string | null) {
  const [gitStatusLines, setGitStatusLines] = useState<string[]>([])
  const [gitDiffText, setGitDiffText] = useState<string>('')
  const [isFetchingGit, setIsFetchingGit] = useState<boolean>(false)

  const fetchGitStatusAndDiff = useCallback(async () => {
    if (!window.electronAPI) return
    setIsFetchingGit(true)
    try {
      // `git diff` alone never shows untracked (new) files, only tracked ones that changed --
      // so an agent run that mostly creates new files always parsed as an empty diff / +0 -0.
      // Intent-to-add makes untracked files visible to `git diff` as pure additions without
      // staging their content, then `git reset` on those same paths undoes the marker so the
      // working tree (and anything the user had actually staged) is left exactly as found.
      const diffCommand = [
        'git status --short',
        `Write-Host "${GIT_SPLIT_MARKER}"`,
        '$untracked = git ls-files --others --exclude-standard',
        'if ($untracked) { git add -N -- $untracked }',
        'git diff -U3',
        'if ($untracked) { git reset -- $untracked }',
      ].join('; ')

      const res = await window.electronAPI.executePowerShellCommand(diffCommand, workspacePath || undefined)
      const parts = (res.output || '').split(GIT_SPLIT_MARKER)
      const statusRaw = (parts[0] || '').trim()
      const diffRaw = (parts[1] || '').trim()

      setGitStatusLines(statusRaw ? statusRaw.split('\n') : ['No modified files detected in Git working tree.'])
      setGitDiffText(diffRaw || 'No uncommitted changes in Git working tree.')
    } catch (err: any) {
      setGitStatusLines(['Git command failed or not a Git repository.'])
      setGitDiffText(`Git error: ${err.message}`)
    } finally {
      setIsFetchingGit(false)
    }
  }, [workspacePath])

  return { gitStatusLines, gitDiffText, isFetchingGit, fetchGitStatusAndDiff }
}
