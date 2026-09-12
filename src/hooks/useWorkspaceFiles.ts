import React, { useCallback, useEffect, useRef, useState } from 'react'
import { WorkspaceFile } from '../types'
import { logger } from '../lib/logger'

const EMPTY_EDITOR_PLACEHOLDER = '// Select a workspace file on the left to edit and inspect code.'

export interface UseWorkspaceFilesOptions {
  workspacePath: string | null
  isStandaloneMode: boolean
  /** Surfaces file-level events (pin, unpin, save) in the agent action log. */
  onFileNotice: (message: string) => void
  /** Called when a deleted path must also be purged from other contexts (attached documents). */
  onPathPurged: (isInsideDeletedPath: (filePath: string) => boolean) => void
}

export interface EditorSaveConflict {
  filePath: string
  fileName: string
  localContent: string
  diskContent: string
  diskContentHash: string
}

/**
 * File tree, open tabs, Monaco editor buffer and pinned context files of the active
 * workspace. Deletions performed by the agent are purged from every reference here, so
 * the UI never points at a path that no longer exists.
 */
export function useWorkspaceFiles({ workspacePath, isStandaloneMode, onFileNotice, onPathPurged }: UseWorkspaceFilesOptions) {
  const [files, setFiles] = useState<WorkspaceFile[]>([])
  const [openFiles, setOpenFiles] = useState<WorkspaceFile[]>([])
  const [selectedFile, setSelectedFile] = useState<WorkspaceFile | null>(null)
  const [editorContent, setEditorContent] = useState<string>(EMPTY_EDITOR_PLACEHOLDER)
  const [originalContent, setOriginalContent] = useState<string>('')
  const [isSaved, setIsSaved] = useState<boolean>(true)
  const [loadedContentHash, setLoadedContentHash] = useState<string | undefined>()
  const [saveConflict, setSaveConflict] = useState<EditorSaveConflict | null>(null)
  const [pinnedFiles, setPinnedFiles] = useState<Map<string, WorkspaceFile>>(new Map())
  const latestRequestedPathRef = useRef<string | null>(null)

  /** Drops file tree, tabs, editor buffer and pins; used when no workspace is attached. */
  const resetWorkspaceFiles = useCallback(() => {
    latestRequestedPathRef.current = null
    setFiles([])
    setOpenFiles([])
    setSelectedFile(null)
    setEditorContent(EMPTY_EDITOR_PLACEHOLDER)
    setOriginalContent('')
    setIsSaved(true)
    setLoadedContentHash(undefined)
    setSaveConflict(null)
    setPinnedFiles(new Map())
  }, [])

  const loadWorkspaceFiles = useCallback(
    async (targetPath?: string | null) => {
      if (isStandaloneMode || !targetPath) {
        resetWorkspaceFiles()
        return
      }
      if (!window.electronAPI) return
      try {
        setFiles(await window.electronAPI.listWorkspaceFiles(targetPath))
      } catch (err: any) {
        logger.warn('useWorkspaceFiles', `Error loading workspace files: ${err?.message}`)
      }
    },
    [isStandaloneMode, resetWorkspaceFiles]
  )

  const handleOpenFile = useCallback(async (file: WorkspaceFile) => {
    if (file.isDir) return
    const requestedPath = file.path
    latestRequestedPathRef.current = requestedPath
    setSelectedFile(file)
    setOpenFiles((prev) => (prev.some((f) => f.path === file.path) ? prev : [...prev, file]))
    if (!window.electronAPI) return

    try {
      const res = await window.electronAPI.readWorkspaceFile(file.path)
      if (latestRequestedPathRef.current !== requestedPath) return

      if (res.success && res.content !== undefined) {
        setEditorContent(res.content)
        setOriginalContent(res.content)
        setIsSaved(true)
        setLoadedContentHash(res.contentHash)
        setSaveConflict(null)
      } else if (res.error) {
        setEditorContent(`// Errore durante la lettura del file: ${res.error}`)
          setOriginalContent('')
          setLoadedContentHash(undefined)
          setSaveConflict(null)
      }
    } catch (err: any) {
      if (latestRequestedPathRef.current !== requestedPath) return
      setEditorContent(`// Errore lettura file: ${err.message}`)
      setOriginalContent('')
    }
  }, [])

  const handleCloseFile = useCallback(
    (fileToClose: WorkspaceFile, e?: React.MouseEvent) => {
      if (e) e.stopPropagation()
      setOpenFiles((prev) => {
        const next = prev.filter((f) => f.path !== fileToClose.path)
        if (selectedFile?.path === fileToClose.path) {
          if (next.length > 0) {
            const nextFile = next[next.length - 1]
            queueMicrotask(() => handleOpenFile(nextFile))
          } else {
            setSelectedFile(null)
            setEditorContent('')
            setOriginalContent('')
          }
        }
        return next
      })
    },
    [handleOpenFile, selectedFile]
  )

  const handleSaveFile = useCallback(async () => {
    if (!selectedFile || !window.electronAPI) return
    const res = await window.electronAPI.writeWorkspaceFile(selectedFile.path, editorContent, loadedContentHash, workspacePath || undefined)
    if (res.success) {
      setOriginalContent(editorContent)
      setIsSaved(true)
      setLoadedContentHash(res.contentHash)
      setSaveConflict(null)
      onFileNotice(`Saved changes to ${selectedFile.name}`)
    } else if (res.conflict && res.currentContentHash && res.currentContent !== undefined) {
      setSaveConflict({
        filePath: selectedFile.path,
        fileName: selectedFile.name,
        localContent: editorContent,
        diskContent: res.currentContent,
        diskContentHash: res.currentContentHash,
      })
    }
  }, [selectedFile, editorContent, loadedContentHash, onFileNotice, workspacePath])

  const handleReloadConflict = useCallback(() => {
    if (!saveConflict) return
    setEditorContent(saveConflict.diskContent)
    setOriginalContent(saveConflict.diskContent)
    setLoadedContentHash(saveConflict.diskContentHash)
    setIsSaved(true)
    setSaveConflict(null)
    onFileNotice(`Reloaded ${saveConflict.fileName} from disk`)
  }, [onFileNotice, saveConflict])

  const handleMergeConflict = useCallback(() => {
    if (!saveConflict) return
    setEditorContent(`<<<<<<< EDITOR\n${saveConflict.localContent}\n=======\n${saveConflict.diskContent}\n>>>>>>> DISK`)
    setOriginalContent(saveConflict.diskContent)
    setLoadedContentHash(saveConflict.diskContentHash)
    setIsSaved(false)
    setSaveConflict(null)
    onFileNotice(`Prepared manual merge for ${saveConflict.fileName}`)
  }, [onFileNotice, saveConflict])

  const handleOverwriteConflict = useCallback(async () => {
    if (!saveConflict || !window.electronAPI) return
    const res = await window.electronAPI.writeWorkspaceFile(
      saveConflict.filePath,
      saveConflict.localContent,
      saveConflict.diskContentHash,
      workspacePath || undefined,
    )
    if (res.success) {
      setEditorContent(saveConflict.localContent)
      setOriginalContent(saveConflict.localContent)
      setLoadedContentHash(res.contentHash)
      setIsSaved(true)
      setSaveConflict(null)
      onFileNotice(`Overwrote ${saveConflict.fileName} after conflict confirmation`)
    } else if (res.conflict && res.currentContentHash && res.currentContent !== undefined) {
      setSaveConflict((current) => current ? {
        ...current,
        diskContent: res.currentContent!,
        diskContentHash: res.currentContentHash!,
      } : current)
    }
  }, [onFileNotice, saveConflict, workspacePath])

  const handleTogglePinFile = useCallback(
    (file: WorkspaceFile) => {
      if (file.isDir) return
      setPinnedFiles((prev) => {
        const next = new Map(prev)
        if (next.has(file.path)) {
          next.delete(file.path)
          onFileNotice(`Unpinned referenced file: ${file.name}`)
        } else {
          next.set(file.path, file)
          onFileNotice(`Pinned referenced file to chat context: ${file.name}`)
        }
        return next
      })
    },
    [onFileNotice]
  )

  /** Drops every reference (tabs, editor, pins) to a path deleted from the workspace. */
  const purgeFileReferences = useCallback(
    (deletedPath: string) => {
      if (!deletedPath) return
      const normDel = deletedPath.replace(/\\/g, '/').toLowerCase()
      const isInside = (filePath: string) => {
        if (!filePath) return false
        const normFile = filePath.replace(/\\/g, '/').toLowerCase()
        return normFile === normDel || normFile.startsWith(normDel.endsWith('/') ? normDel : `${normDel}/`)
      }

      setOpenFiles((prev) => {
        const remaining = prev.filter((f) => !isInside(f.path))
        if (selectedFile && isInside(selectedFile.path)) {
          if (remaining.length > 0) {
            const nextFile = remaining[remaining.length - 1]
            queueMicrotask(() => handleOpenFile(nextFile))
          } else {
            setSelectedFile(null)
            setEditorContent('')
            setOriginalContent('')
            setLoadedContentHash(undefined)
            setSaveConflict(null)
          }
        }
        return remaining
      })

      setPinnedFiles((prev) => {
        const next = new Map(prev)
        for (const [path] of next) {
          if (isInside(path)) next.delete(path)
        }
        return next
      })

      onPathPurged(isInside)

      if (workspacePath) loadWorkspaceFiles(workspacePath)
    },
    [workspacePath, handleOpenFile, loadWorkspaceFiles, onPathPurged, selectedFile]
  )

  useEffect(() => {
    resetWorkspaceFiles()
    void loadWorkspaceFiles(workspacePath)
  }, [workspacePath, isStandaloneMode, loadWorkspaceFiles, resetWorkspaceFiles])

  useEffect(() => {
    if (!window.electronAPI?.onAgentChangeMetrics) return
    const unsub = window.electronAPI.onAgentChangeMetrics(() => {
      if (workspacePath) {
        void loadWorkspaceFiles(workspacePath)
      }
    })
    return () => {
      unsub?.()
    }
  }, [workspacePath, loadWorkspaceFiles])

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onWorkspaceFileVersionChanged) return
    return api.onWorkspaceFileVersionChanged(async (event) => {
      if (!selectedFile || event.filePath.replace(/\\/g, '/').toLowerCase() !== selectedFile.path.replace(/\\/g, '/').toLowerCase()) return
      if (event.deleted) {
        purgeFileReferences(event.filePath)
        return
      }
      if (!event.contentHash || event.contentHash === loadedContentHash) return

      const result = await api.readWorkspaceFile(event.filePath)
      if (!result.success || result.content === undefined || !result.contentHash) return
      if (isSaved) {
        setEditorContent(result.content)
        setOriginalContent(result.content)
        setLoadedContentHash(result.contentHash)
      } else {
        setSaveConflict({
          filePath: event.filePath,
          fileName: selectedFile.name,
          localContent: editorContent,
          diskContent: result.content,
          diskContentHash: result.contentHash,
        })
      }
    })
  }, [editorContent, isSaved, loadedContentHash, purgeFileReferences, selectedFile])

  return {
    files,
    openFiles,
    selectedFile,
    setSelectedFile,
    editorContent,
    setEditorContent,
    originalContent,
    loadedContentHash,
    isSaved,
    saveConflict,
    setIsSaved,
    pinnedFiles,
    setPinnedFiles,
    loadWorkspaceFiles,
    handleOpenFile,
    handleCloseFile,
    handleSaveFile,
    handleReloadConflict,
    handleMergeConflict,
    handleOverwriteConflict,
    handleTogglePinFile,
    purgeFileReferences,
    resetWorkspaceFiles,
  }
}
