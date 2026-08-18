import React, { useCallback, useEffect, useState } from 'react'
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
  const [pinnedFiles, setPinnedFiles] = useState<Map<string, WorkspaceFile>>(new Map())

  /** Drops file tree, tabs, editor buffer and pins; used when no workspace is attached. */
  const resetWorkspaceFiles = useCallback(() => {
    setFiles([])
    setOpenFiles([])
    setSelectedFile(null)
    setEditorContent(EMPTY_EDITOR_PLACEHOLDER)
    setOriginalContent('')
    setIsSaved(true)
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
    setSelectedFile(file)
    setOpenFiles((prev) => (prev.some((f) => f.path === file.path) ? prev : [...prev, file]))
    if (!window.electronAPI) return

    try {
      const res = await window.electronAPI.readWorkspaceFile(file.path)
      if (res.success && res.content !== undefined) {
        setEditorContent(res.content)
        setOriginalContent(res.content)
        setIsSaved(true)
      } else if (res.error) {
        setEditorContent(`// Errore durante la lettura del file: ${res.error}`)
        setOriginalContent('')
      }
    } catch (err: any) {
      setEditorContent(`// Errore lettura file: ${err.message}`)
      setOriginalContent('')
    }
  }, [])

  const handleCloseFile = useCallback(
    (fileToClose: WorkspaceFile, e?: React.MouseEvent) => {
      if (e) e.stopPropagation()
      setOpenFiles((prev) => {
        const next = prev.filter((f) => f.path !== fileToClose.path)
        setSelectedFile((curr) => {
          if (curr?.path !== fileToClose.path) return curr
          if (next.length > 0) {
            handleOpenFile(next[next.length - 1])
            return curr
          }
          setEditorContent('')
          setOriginalContent('')
          return null
        })
        return next
      })
    },
    [handleOpenFile]
  )

  const handleSaveFile = useCallback(async () => {
    if (!selectedFile || !window.electronAPI) return
    const res = await window.electronAPI.writeWorkspaceFile(selectedFile.path, editorContent)
    if (res.success) {
      setOriginalContent(editorContent)
      setIsSaved(true)
      onFileNotice(`Saved changes to ${selectedFile.name}`)
    }
  }, [selectedFile, editorContent, onFileNotice])

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
        setSelectedFile((curr) => {
          if (!curr || !isInside(curr.path)) return curr
          if (remaining.length > 0) {
            handleOpenFile(remaining[remaining.length - 1])
            return curr
          }
          setEditorContent('')
          setOriginalContent('')
          return null
        })
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
    [workspacePath, handleOpenFile, loadWorkspaceFiles, onPathPurged]
  )

  useEffect(() => {
    void loadWorkspaceFiles(workspacePath)
  }, [workspacePath, isStandaloneMode, loadWorkspaceFiles])

  return {
    files,
    openFiles,
    selectedFile,
    setSelectedFile,
    editorContent,
    setEditorContent,
    originalContent,
    isSaved,
    setIsSaved,
    pinnedFiles,
    setPinnedFiles,
    loadWorkspaceFiles,
    handleOpenFile,
    handleCloseFile,
    handleSaveFile,
    handleTogglePinFile,
    purgeFileReferences,
    resetWorkspaceFiles,
  }
}
