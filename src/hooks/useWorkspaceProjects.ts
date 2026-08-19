import { useCallback, useEffect, useState } from 'react'
import { AppSettings, WorkspaceProject } from '../types'
import { logger } from '../lib/logger'

const LAST_WORKSPACE_STORAGE_KEY = 'onlyrag_last_workspace'
const LEGACY_PROJECTS_STORAGE_KEY = 'onlyrag_workspace_projects'
const MIGRATION_FLAG_KEY = 'onlyrag_projects_migrated_to_main_v1'

function deriveNameFromPath(pathStr: string): string {
  return pathStr.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'Workspace'
}

/**
 * One-shot import of the project list previously kept in localStorage. Runs once per
 * installation: the legacy key is dropped only after the main process confirms the
 * import, so a failed migration is retried on the next launch instead of losing data.
 */
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

/**
 * Saved project folders and the workspace root the Coding Agent Studio is attached to,
 * including standalone (no-workspace) mode. The project list itself is owned by the main
 * process (see projectRegistryRepository), so it's available to every window and survives
 * independently of any single renderer's localStorage; this hook mirrors it in memory.
 * File tree and editor state live in `useWorkspaceFiles`, which reloads itself from the
 * values returned here.
 */
export function useWorkspaceProjects(settings?: AppSettings) {
  const [projects, setProjects] = useState<WorkspaceProject[]>([])
  const [workspacePath, setWorkspacePath] = useState<string | null>(
    () => settings?.customWorkspacePath || localStorage.getItem(LAST_WORKSPACE_STORAGE_KEY) || null
  )
  const [isStandaloneMode, setIsStandaloneMode] = useState<boolean>(settings?.noWorkspaceMode || false)

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

  const handleSelectProject = useCallback((pathStr: string) => {
    setWorkspacePath(pathStr)
    try {
      localStorage.setItem(LAST_WORKSPACE_STORAGE_KEY, pathStr)
    } catch (err: any) {
      logger.warn('useWorkspaceProjects', `Failed saving last workspace: ${err?.message}`)
    }
    setIsStandaloneMode(false)

    // Optimistic reorder so the sidebar reflects the new active project instantly;
    // reconciled below with the authoritative registry entry once the IPC round-trip resolves.
    const nowIso = new Date().toISOString()
    setProjects((prev) => {
      const existing = prev.find((p) => p.path === pathStr)
      const optimistic: WorkspaceProject = existing
        ? { ...existing, lastOpenedAt: nowIso }
        : { path: pathStr, name: deriveNameFromPath(pathStr), addedAt: nowIso, lastOpenedAt: nowIso }
      return [optimistic, ...prev.filter((p) => p.path !== pathStr)]
    })

    void (async () => {
      if (!window.electronAPI?.touchProject) return
      try {
        // touchProject never creates: a path not yet in the registry (e.g. opened via a
        // stale link or CLI arg) falls back to registerProject.
        let entry = await window.electronAPI.touchProject(pathStr)
        if (!entry && window.electronAPI.registerProject) {
          entry = await window.electronAPI.registerProject(pathStr)
        }
        if (entry) {
          const confirmed = entry
          setProjects((prev) => [confirmed, ...prev.filter((p) => p.path !== pathStr)])
        }
      } catch (err: any) {
        logger.warn('useWorkspaceProjects', `Could not update project registry: ${err?.message}`)
      }
    })()
  }, [])

  const handleAddProject = useCallback(async () => {
    if (!window.electronAPI?.openDirectoryDialog) return
    const chosen = await window.electronAPI.openDirectoryDialog({
      title: 'Aggiungi Cartella Progetto per Coding Agent Studio',
    })
    if (chosen) handleSelectProject(chosen)
  }, [handleSelectProject])

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
