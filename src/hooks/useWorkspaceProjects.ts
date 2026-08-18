import { useCallback, useState } from 'react'
import { AppSettings, WorkspaceProject } from '../types'
import { logger } from '../lib/logger'

const LAST_WORKSPACE_STORAGE_KEY = 'onlyrag_last_workspace'
const PROJECTS_STORAGE_KEY = 'onlyrag_workspace_projects'

function loadSavedProjects(): WorkspaceProject[] {
  try {
    const raw = localStorage.getItem(PROJECTS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    }
  } catch (err: any) {
    logger.warn('useWorkspaceProjects', `Could not parse saved projects: ${err?.message}`)
  }
  return []
}

function saveSavedProjects(projects: WorkspaceProject[]) {
  try {
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects))
  } catch (err: any) {
    logger.warn('useWorkspaceProjects', `Could not save projects: ${err?.message}`)
  }
}

/**
 * Saved project folders and the workspace root the Coding Agent Studio is attached to,
 * including standalone (no-workspace) mode. File tree and editor state live in
 * `useWorkspaceFiles`, which reloads itself from the values returned here.
 */
export function useWorkspaceProjects(settings?: AppSettings) {
  const [projects, setProjects] = useState<WorkspaceProject[]>(() => loadSavedProjects())
  const [workspacePath, setWorkspacePath] = useState<string | null>(
    () => settings?.customWorkspacePath || localStorage.getItem(LAST_WORKSPACE_STORAGE_KEY) || null
  )
  const [isStandaloneMode, setIsStandaloneMode] = useState<boolean>(settings?.noWorkspaceMode || false)

  const handleSelectProject = useCallback(
    (pathStr: string) => {
      setWorkspacePath(pathStr)
      try {
        localStorage.setItem(LAST_WORKSPACE_STORAGE_KEY, pathStr)
      } catch (err: any) {
        logger.warn('useWorkspaceProjects', `Failed saving last workspace: ${err?.message}`)
      }
      setProjects((prev) => {
        const folderName = pathStr.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'Workspace'
        const nowIso = new Date().toISOString()
        const updated: WorkspaceProject[] = [
          { path: pathStr, name: folderName, addedAt: nowIso, lastOpenedAt: nowIso },
          ...prev.filter((p) => p.path !== pathStr),
        ]
        saveSavedProjects(updated)
        return updated
      })
      setIsStandaloneMode(false)
    },
    []
  )

  const handleAddProject = useCallback(async () => {
    if (!window.electronAPI?.openDirectoryDialog) return
    const chosen = await window.electronAPI.openDirectoryDialog({
      title: 'Aggiungi Cartella Progetto per Coding Agent Studio',
    })
    if (chosen) handleSelectProject(chosen)
  }, [handleSelectProject])

  const handleRemoveProject = useCallback(
    (pathStr: string) => {
      setProjects((prev) => {
        const updated = prev.filter((p) => p.path !== pathStr)
        saveSavedProjects(updated)

        if (pathStr === workspacePath) {
          if (updated.length > 0) {
            handleSelectProject(updated[0].path)
          } else {
            setWorkspacePath(null)
            try {
              localStorage.removeItem(LAST_WORKSPACE_STORAGE_KEY)
            } catch (err: any) {
              logger.warn('useWorkspaceProjects', `Could not clear last workspace: ${err?.message}`)
            }
          }
        }

        return updated
      })
    },
    [workspacePath, handleSelectProject]
  )

  const handleToggleStandalone = useCallback(() => {
    setIsStandaloneMode((prev) => !prev)
  }, [])

  return {
    projects,
    workspacePath,
    isStandaloneMode,
    handleSelectProject,
    handleAddProject,
    handleRemoveProject,
    handleSelectWorkspaceFolder: handleAddProject,
    handleToggleStandalone,
  }
}
