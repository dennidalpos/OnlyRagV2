import { useCallback, useEffect, useRef, useState } from 'react'
import { AppSettings, WorkspaceProject } from '../types'
import { logger } from '../lib/logger'
import { errorMessage } from '../../shared/domain/errors/errorMessage'
import { translate } from '../i18n/I18nContext'

const LAST_WORKSPACE_STORAGE_KEY = 'onlyrag_last_workspace'

/** Saved project folders and the workspace root the Coding Agent Studio is attached to, including standalone (no-workspace) mode. */
export function useWorkspaceProjects(settings?: AppSettings) {
  const startsStandalone = settings?.noWorkspaceMode || false
  const [projects, setProjects] = useState<WorkspaceProject[]>([])
  const [registryFailed, setRegistryFailed] = useState(false)
  const mounted = useRef(false)
  const registryRevision = useRef(0)
  const [workspacePath, setWorkspacePath] = useState<string | null>(() =>
    startsStandalone ? null : settings?.customWorkspacePath || localStorage.getItem(LAST_WORKSPACE_STORAGE_KEY) || null,
  )
  const [isStandaloneMode, setIsStandaloneMode] = useState<boolean>(startsStandalone)
  const [standaloneWorkspacePath, setStandaloneWorkspacePath] = useState<string | null>(null)
  const currentWorkspace = useRef(workspacePath)
  currentWorkspace.current = workspacePath

  const reloadRegistry = useCallback(async (clearFailure: boolean): Promise<WorkspaceProject[] | null> => {
    if (!mounted.current) return null
    const revision = ++registryRevision.current
    if (!window.electronAPI?.listProjects) return null
    try {
      const list = await window.electronAPI.listProjects()
      if (mounted.current && revision === registryRevision.current) {
        setProjects(list)
        if (clearFailure) setRegistryFailed(false)
        return list
      }
    } catch (err: unknown) {
      logger.warn('useWorkspaceProjects', `Could not load project registry: ${errorMessage(err)}`)
      if (mounted.current && revision === registryRevision.current) setRegistryFailed(true)
    }
    return null
  }, [])
  const retryRegistry = useCallback(() => void reloadRegistry(true), [reloadRegistry])

  useEffect(() => {
    mounted.current = true
    void reloadRegistry(true)
    return () => {
      mounted.current = false
      registryRevision.current++
    }
  }, [reloadRegistry])

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
        currentWorkspace.current = standaloneWorkspacePath
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
      currentWorkspace.current = cleanPath
      setWorkspacePath(cleanPath)
      try {
        localStorage.setItem(LAST_WORKSPACE_STORAGE_KEY, cleanPath)
      } catch (err: unknown) {
        logger.warn('useWorkspaceProjects', `Failed saving last workspace: ${errorMessage(err)}`)
      }
      setIsStandaloneMode(false)

      registryRevision.current++

      void (async () => {
        try {
          if (!window.electronAPI?.touchProject) throw new Error('Project registry is unavailable')
          let entry = await window.electronAPI.touchProject({ projectPath: cleanPath })
          if (!entry && window.electronAPI.registerProject) {
            entry = await window.electronAPI.registerProject({ projectPath: cleanPath })
          }
          if (!entry) throw new Error('Project registration was not acknowledged')
        } catch (err: unknown) {
          logger.warn('useWorkspaceProjects', `Could not update project registry: ${errorMessage(err)}`)
          if (mounted.current) setRegistryFailed(true)
        }
        await reloadRegistry(false)
      })()
    },
    [ensureStandaloneWorkspace, standaloneWorkspacePath, reloadRegistry],
  )

  const handleAddProject = useCallback(async () => {
    if (!window.electronAPI?.openDirectoryDialog) return
    const chosen = await window.electronAPI.openDirectoryDialog({
      title: translate('services.addProjectFolder'),
    })
    if (chosen) handleSelectProject(chosen)
  }, [handleSelectProject])

  const handleRenameProject = useCallback(
    async (projectPath: string, newName: string) => {
      const cleanName = newName.trim()
      if (!cleanName || !projectPath) return
      registryRevision.current++
      try {
        if (!window.electronAPI?.renameProject) throw new Error('Project registry is unavailable')
        if (!(await window.electronAPI.renameProject({ projectPath, name: cleanName }))) throw new Error('Project rename was not acknowledged')
      } catch (err: unknown) {
        logger.warn('useWorkspaceProjects', `Could not rename project in registry: ${errorMessage(err)}`)
        if (mounted.current) setRegistryFailed(true)
      }
      await reloadRegistry(false)
    },
    [reloadRegistry],
  )

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
    async (pathStr: string): Promise<boolean> => {
      registryRevision.current++
      try {
        if (!window.electronAPI?.removeProjectFromRegistry) throw new Error('Project registry is unavailable')
        if (!(await window.electronAPI.removeProjectFromRegistry({ projectPath: pathStr }))) throw new Error('Project removal was not acknowledged')
      } catch (err: unknown) {
        logger.warn('useWorkspaceProjects', `Could not remove project from registry: ${errorMessage(err)}`)
        if (mounted.current) setRegistryFailed(true)
        await reloadRegistry(false)
        return false
      }
      if (!mounted.current) return true
      setProjects((prev) => prev.filter((p) => p.path !== pathStr))
      const updated = await reloadRegistry(false)
      if (mounted.current && currentWorkspace.current === pathStr) handleSelectProject((updated || projects.filter((p) => p.path !== pathStr))[0]?.path || null)
      return true
    },
    [projects, handleSelectProject, reloadRegistry],
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
    registryFailed,
    retryRegistry,
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
