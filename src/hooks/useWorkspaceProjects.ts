import { useCallback, useEffect, useState } from 'react'
import { AppSettings, WorkspaceProject } from '../types'
import { logger } from '../lib/logger'
import { errorMessage } from '../../shared/domain/errors/errorMessage'
import { translate } from '../i18n/I18nContext'

const LAST_WORKSPACE_STORAGE_KEY = 'onlyrag_last_workspace'

function deriveNameFromPath(pathStr: string): string {
  return pathStr.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'Workspace'
}

/** Saved project folders and the workspace root the Coding Agent Studio is attached to, including standalone (no-workspace) mode. */
export function useWorkspaceProjects(settings?: AppSettings) {
  const startsStandalone = settings?.noWorkspaceMode || false
  const [projects, setProjects] = useState<WorkspaceProject[]>([])
  const [workspacePath, setWorkspacePath] = useState<string | null>(() =>
    startsStandalone ? null : settings?.customWorkspacePath || localStorage.getItem(LAST_WORKSPACE_STORAGE_KEY) || null,
  )
  const [isStandaloneMode, setIsStandaloneMode] = useState<boolean>(startsStandalone)
  const [standaloneWorkspacePath, setStandaloneWorkspacePath] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const loadProjects = async () => {
      if (!window.electronAPI?.listProjects) return
      try {
        const list = await window.electronAPI.listProjects()
        if (!cancelled) setProjects(list)
      } catch (err: unknown) {
        logger.warn('useWorkspaceProjects', `Could not load project registry: ${errorMessage(err)}`)
      }
    }
    void loadProjects()
    return () => {
      cancelled = true
    }
  }, [])

  const ensureStandaloneWorkspace = useCallback(async (): Promise<string | null> => {
    if (standaloneWorkspacePath) return standaloneWorkspacePath
    if (!window.electronAPI?.getStandaloneScratchWorkspace) return null
    try {
      const result = await window.electronAPI.getStandaloneScratchWorkspace()
      setStandaloneWorkspacePath(result.path)
      return result.path
    } catch (err: unknown) {
      logger.warn('useWorkspaceProjects', `Could not initialize standalone scratch workspace: ${errorMessage(err)}`)
      return null
    }
  }, [standaloneWorkspacePath])

  useEffect(() => {
    if (!isStandaloneMode) return
    void ensureStandaloneWorkspace().then((scratchPath) => {
      if (scratchPath) setWorkspacePath(scratchPath)
    })
  }, [ensureStandaloneWorkspace, isStandaloneMode])

  const handleSelectProject = useCallback(
    (pathStr: string | null) => {
      if (!pathStr || !pathStr.trim()) {
        setIsStandaloneMode(true)
        setWorkspacePath(standaloneWorkspacePath)
        void ensureStandaloneWorkspace().then((scratchPath) => {
          if (scratchPath) setWorkspacePath(scratchPath)
        })
        try {
          localStorage.removeItem(LAST_WORKSPACE_STORAGE_KEY)
        } catch (err: unknown) {
          logger.warn('useWorkspaceProjects', `Failed clearing last workspace: ${errorMessage(err)}`)
        }
        return
      }

      const cleanPath = pathStr.trim()
      setWorkspacePath(cleanPath)
      try {
        localStorage.setItem(LAST_WORKSPACE_STORAGE_KEY, cleanPath)
      } catch (err: unknown) {
        logger.warn('useWorkspaceProjects', `Failed saving last workspace: ${errorMessage(err)}`)
      }
      setIsStandaloneMode(false)

      // Optimistic reorder so the sidebar reflects the new active project instantly;
      // reconciled below with the authoritative registry entry once the IPC round-trip resolves.
      const nowIso = new Date().toISOString()
      setProjects((prev) => {
        const existing = prev.find((p) => p.path === cleanPath)
        const optimistic: WorkspaceProject = existing
          ? { ...existing, lastOpenedAt: nowIso }
          : { path: cleanPath, name: deriveNameFromPath(cleanPath), addedAt: nowIso, lastOpenedAt: nowIso }
        return [optimistic, ...prev.filter((p) => p.path !== cleanPath)]
      })

      void (async () => {
        if (!window.electronAPI?.touchProject) return
        try {
          let entry = await window.electronAPI.touchProject({ projectPath: cleanPath })
          if (!entry && window.electronAPI.registerProject) {
            entry = await window.electronAPI.registerProject({ projectPath: cleanPath })
          }
          if (entry) {
            const confirmed = entry
            setProjects((prev) => [confirmed, ...prev.filter((p) => p.path !== cleanPath)])
          }
        } catch (err: unknown) {
          logger.warn('useWorkspaceProjects', `Could not update project registry: ${errorMessage(err)}`)
        }
      })()
    },
    [ensureStandaloneWorkspace, standaloneWorkspacePath],
  )

  const handleAddProject = useCallback(async () => {
    if (!window.electronAPI?.openDirectoryDialog) return
    const chosen = await window.electronAPI.openDirectoryDialog({
      title: translate('services.addProjectFolder'),
    })
    if (chosen) handleSelectProject(chosen)
  }, [handleSelectProject])

  const handleRenameProject = useCallback(async (projectPath: string, newName: string) => {
    const cleanName = newName.trim()
    if (!cleanName || !projectPath) return
    setProjects((prev) => prev.map((p) => (p.path === projectPath ? { ...p, name: cleanName } : p)))
    if (window.electronAPI?.renameProject) {
      try {
        await window.electronAPI.renameProject({ projectPath, name: cleanName })
      } catch (err: unknown) {
        logger.warn('useWorkspaceProjects', `Could not rename project in registry: ${errorMessage(err)}`)
      }
    }
  }, [])

  const handleOpenProjectPath = useCallback(async (projectPath: string) => {
    if (!projectPath || !projectPath.trim()) return
    if (window.electronAPI?.openPath) {
      try {
        await window.electronAPI.openPath({ targetPath: projectPath.trim() })
      } catch (err: unknown) {
        logger.warn('useWorkspaceProjects', `Could not open project path: ${errorMessage(err)}`)
      }
    }
  }, [])

  const handleRemoveProject = useCallback(
    (pathStr: string) => {
      if (window.electronAPI?.removeProjectFromRegistry) {
        window.electronAPI.removeProjectFromRegistry({ projectPath: pathStr }).catch((err: unknown) => {
          logger.warn('useWorkspaceProjects', `Could not remove project from registry: ${errorMessage(err)}`)
        })
      }

      setProjects((prev) => {
        const updated = prev.filter((p) => p.path !== pathStr)

        if (pathStr === workspacePath) {
          if (updated.length > 0) {
            handleSelectProject(updated[0].path)
          } else {
            handleSelectProject(null)
          }
        }

        return updated
      })
    },
    [workspacePath, handleSelectProject],
  )

  const handleToggleStandalone = useCallback(() => {
    if (isStandaloneMode) {
      const previousWorkspace = localStorage.getItem(LAST_WORKSPACE_STORAGE_KEY)
      if (previousWorkspace) handleSelectProject(previousWorkspace)
      return
    }
    handleSelectProject(null)
  }, [handleSelectProject, isStandaloneMode])

  return {
    projects,
    workspacePath,
    standaloneWorkspacePath,
    isStandaloneMode,
    handleSelectProject,
    handleAddProject,
    handleRenameProject,
    handleOpenProjectPath,
    handleRemoveProject,
    handleSelectWorkspaceFolder: handleAddProject,
    handleToggleStandalone,
  }
}
