import { useCallback, useEffect, useState } from 'react'
import { AppSettings, WorkspaceProject } from '../types'
import { logger } from '../lib/logger'

const LAST_WORKSPACE_STORAGE_KEY = 'onlyrag_last_workspace'
const LEGACY_PROJECTS_STORAGE_KEY = 'onlyrag_workspace_projects'
const MIGRATION_FLAG_KEY = 'onlyrag_projects_migrated_to_main_v1'

function deriveNameFromPath(pathStr: string): string {
  return pathStr.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'Workspace'
}

/** One-shot import of the project list previously kept in localStorage. */
async function migrateLegacyProjects(): Promise<void> {
  if (localStorage.getItem(MIGRATION_FLAG_KEY) === 'done') return
  const raw = localStorage.getItem(LEGACY_PROJECTS_STORAGE_KEY)
  if (!raw) {
    localStorage.setItem(MIGRATION_FLAG_KEY, 'done')
    return
  }
  if (!window.electronAPI?.migrateLegacyProjects) return

  try {
    const parsed = JSON.parse(raw)
    const res = await window.electronAPI.migrateLegacyProjects(parsed)
    localStorage.removeItem(LEGACY_PROJECTS_STORAGE_KEY)
    localStorage.setItem(MIGRATION_FLAG_KEY, 'done')
    logger.info('useWorkspaceProjects', `Migrated ${res?.migrated ?? 0} legacy project(s) to the main-process registry.`)
  } catch (err: any) {
    logger.warn('useWorkspaceProjects', `Legacy project migration failed, will retry on next launch: ${err?.message}`)
  }
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
      await migrateLegacyProjects()
      if (!window.electronAPI?.listProjects) return
      try {
        const list = await window.electronAPI.listProjects()
        if (!cancelled) setProjects(list)
      } catch (err: any) {
        logger.warn('useWorkspaceProjects', `Could not load project registry: ${err?.message}`)
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
    } catch (err: any) {
      logger.warn('useWorkspaceProjects', `Could not initialize standalone scratch workspace: ${err?.message}`)
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
        } catch (err: any) {
          logger.warn('useWorkspaceProjects', `Failed clearing last workspace: ${err?.message}`)
        }
        return
      }

      const cleanPath = pathStr.trim()
      setWorkspacePath(cleanPath)
      try {
        localStorage.setItem(LAST_WORKSPACE_STORAGE_KEY, cleanPath)
      } catch (err: any) {
        logger.warn('useWorkspaceProjects', `Failed saving last workspace: ${err?.message}`)
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
          let entry = await window.electronAPI.touchProject(cleanPath)
          if (!entry && window.electronAPI.registerProject) {
            entry = await window.electronAPI.registerProject(cleanPath)
          }
          if (entry) {
            const confirmed = entry
            setProjects((prev) => [confirmed, ...prev.filter((p) => p.path !== cleanPath)])
          }
        } catch (err: any) {
          logger.warn('useWorkspaceProjects', `Could not update project registry: ${err?.message}`)
        }
      })()
    },
    [ensureStandaloneWorkspace, standaloneWorkspacePath],
  )

  const handleAddProject = useCallback(async () => {
    if (!window.electronAPI?.openDirectoryDialog) return
    const chosen = await window.electronAPI.openDirectoryDialog({
      title: 'Aggiungi Cartella Progetto per Coding Agent Studio',
    })
    if (chosen) handleSelectProject(chosen)
  }, [handleSelectProject])

  const handleRenameProject = useCallback(async (projectPath: string, newName: string) => {
    const cleanName = newName.trim()
    if (!cleanName || !projectPath) return
    setProjects((prev) => prev.map((p) => (p.path === projectPath ? { ...p, name: cleanName } : p)))
    if (window.electronAPI?.renameProject) {
      try {
        await window.electronAPI.renameProject(projectPath, cleanName)
      } catch (err: any) {
        logger.warn('useWorkspaceProjects', `Could not rename project in registry: ${err?.message}`)
      }
    }
  }, [])

  const handleOpenProjectPath = useCallback(async (projectPath: string) => {
    if (!projectPath || !projectPath.trim()) return
    if (window.electronAPI?.openPath) {
      try {
        await window.electronAPI.openPath(projectPath.trim())
      } catch (err: any) {
        logger.warn('useWorkspaceProjects', `Could not open project path: ${err?.message}`)
      }
    }
  }, [])

  const handleRemoveProject = useCallback(
    (pathStr: string) => {
      if (window.electronAPI?.removeProjectFromRegistry) {
        window.electronAPI.removeProjectFromRegistry(pathStr).catch((err: any) => {
          logger.warn('useWorkspaceProjects', `Could not remove project from registry: ${err?.message}`)
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
