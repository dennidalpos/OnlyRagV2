import React, { useCallback, useEffect, useRef, useState } from 'react'
import { WorkspaceFile } from '../types'
import { logger } from '../lib/logger'
import { errorMessage } from '../../shared/domain/errors/errorMessage'
import { useTranslation } from '../i18n'

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

interface FileDraft {
  content: string
  originalContent: string
  contentHash?: string
  isSaved: boolean
  isReady: boolean
  revision: number
  conflict: EditorSaveConflict | null
}

/** File tree, open tabs, Monaco editor buffer and pinned context files of the active workspace. */
export function useWorkspaceFiles({ workspacePath, isStandaloneMode, onFileNotice, onPathPurged }: UseWorkspaceFilesOptions) {
  const { t } = useTranslation()
  const [files, setFiles] = useState<WorkspaceFile[]>([])
  const [openFiles, setOpenFiles] = useState<WorkspaceFile[]>([])
  const [selectedFile, setSelectedFile] = useState<WorkspaceFile | null>(null)
  const [editorContent, setEditorContentState] = useState<string>(EMPTY_EDITOR_PLACEHOLDER)
  const [originalContent, setOriginalContent] = useState<string>('')
  const [isSaved, setIsSaved] = useState<boolean>(true)
  const [loadedContentHash, setLoadedContentHash] = useState<string | undefined>()
  const [saveConflict, setSaveConflict] = useState<EditorSaveConflict | null>(null)
  const [pinnedFiles, setPinnedFiles] = useState<Map<string, WorkspaceFile>>(new Map())
  const selectedPathRef = useRef<string | null>(null)
  const selectedFileRef = useRef<WorkspaceFile | null>(null)
  const selectionRevisionRef = useRef(0)
  const listRequestRef = useRef(0)
  const latestListPathRef = useRef<string | null>(null)
  const draftsRef = useRef(new Map<string, FileDraft>())
  const isMountedRef = useRef(true)

  const publishDraft = useCallback((file: WorkspaceFile, draft: FileDraft) => {
    if (!isMountedRef.current || selectedPathRef.current !== file.path) return
    setEditorContentState(draft.content)
    setOriginalContent(draft.originalContent)
    setIsSaved(draft.isSaved)
    setLoadedContentHash(draft.contentHash)
    setSaveConflict(draft.conflict)
  }, [])

  const replaceDraft = useCallback(
    (file: WorkspaceFile, draft: FileDraft) => {
      draftsRef.current.set(file.path, draft)
      publishDraft(file, draft)
    },
    [publishDraft],
  )

  const setEditorContent = useCallback(
    (content: string) => {
      const file = selectedFileRef.current
      if (!file) return
      const current = draftsRef.current.get(file.path)
      if (!current) return
      replaceDraft(file, {
        ...current,
        content,
        isSaved: content === current.originalContent,
        revision: current.revision + 1,
      })
    },
    [replaceDraft],
  )

  const setDraftSaved = useCallback(
    (saved: boolean) => {
      const file = selectedFileRef.current
      if (!file) return
      const current = draftsRef.current.get(file.path)
      if (!current) return
      replaceDraft(file, { ...current, isSaved: saved })
    },
    [replaceDraft],
  )

  /** Drops file tree, tabs, editor buffer and pins; used when no workspace is attached. */
  const resetWorkspaceFiles = useCallback(() => {
    selectionRevisionRef.current += 1
    selectedPathRef.current = null
    selectedFileRef.current = null
    draftsRef.current.clear()
    setFiles([])
    setOpenFiles([])
    setSelectedFile(null)
    setEditorContentState(EMPTY_EDITOR_PLACEHOLDER)
    setOriginalContent('')
    setIsSaved(true)
    setLoadedContentHash(undefined)
    setSaveConflict(null)
    setPinnedFiles(new Map())
  }, [])

  const loadWorkspaceFiles = useCallback(
    async (targetPath?: string | null) => {
      if (!targetPath) {
        resetWorkspaceFiles()
        return
      }
      if (!window.electronAPI) return
      const request = ++listRequestRef.current
      latestListPathRef.current = targetPath
      try {
        const nextFiles = await window.electronAPI.listWorkspaceFiles({ dirPath: targetPath })
        if (request !== listRequestRef.current || latestListPathRef.current !== targetPath || !isMountedRef.current) return
        setFiles(nextFiles)
      } catch (err: unknown) {
        logger.warn('useWorkspaceFiles', `Error loading workspace files: ${errorMessage(err)}`)
      }
    },
    [resetWorkspaceFiles],
  )

  const handleOpenFile = useCallback(
    async (file: WorkspaceFile) => {
      if (file.isDir) return
      const requestedPath = file.path
      const selectionRevision = ++selectionRevisionRef.current
      selectedPathRef.current = requestedPath
      selectedFileRef.current = file
      setSelectedFile(file)
      setOpenFiles((prev) => (prev.some((f) => f.path === file.path) ? prev : [...prev, file]))
      if (!window.electronAPI) return

      const existingDraft = draftsRef.current.get(requestedPath)
      if (existingDraft?.isReady || existingDraft?.isSaved === false) {
        publishDraft(file, existingDraft)
        return
      }

      const pendingDraft: FileDraft = {
        content: '',
        originalContent: '',
        isSaved: true,
        isReady: false,
        revision: 0,
        conflict: null,
      }
      replaceDraft(file, pendingDraft)

      try {
        const res = await window.electronAPI.readWorkspaceFile({ filePath: file.path })
        const current = draftsRef.current.get(requestedPath)
        if (
          !isMountedRef.current ||
          selectedPathRef.current !== requestedPath ||
          selectionRevisionRef.current !== selectionRevision ||
          !current ||
          current.revision !== pendingDraft.revision
        ) {
          return
        }

        if (res.success && res.content !== undefined) {
          replaceDraft(file, {
            ...current,
            content: res.content,
            originalContent: res.content,
            contentHash: res.contentHash,
            isSaved: true,
            isReady: true,
            conflict: null,
          })
        } else if (res.error) {
          replaceDraft(file, {
            ...current,
            content: t('codingWorkspace.fileReadError', { message: res.error }),
            originalContent: '',
            contentHash: undefined,
            isSaved: true,
            isReady: false,
            conflict: null,
          })
        }
      } catch (err: unknown) {
        const current = draftsRef.current.get(requestedPath)
        if (
          !isMountedRef.current ||
          selectedPathRef.current !== requestedPath ||
          selectionRevisionRef.current !== selectionRevision ||
          !current ||
          current.revision !== pendingDraft.revision
        ) {
          return
        }
        replaceDraft(file, {
          ...current,
          content: t('codingWorkspace.fileReadError', { message: errorMessage(err) }),
          originalContent: '',
          contentHash: undefined,
          isSaved: true,
          isReady: false,
          conflict: null,
        })
      }
    },
    [publishDraft, replaceDraft, t],
  )

  const handleCloseFile = useCallback(
    (fileToClose: WorkspaceFile, e?: React.MouseEvent) => {
      if (e) e.stopPropagation()
      setOpenFiles((prev) => {
        const next = prev.filter((f) => f.path !== fileToClose.path)
        if (selectedPathRef.current === fileToClose.path) {
          if (next.length > 0) {
            const nextFile = next[next.length - 1]
            queueMicrotask(() => handleOpenFile(nextFile))
          } else {
            selectionRevisionRef.current += 1
            selectedPathRef.current = null
            selectedFileRef.current = null
            setSelectedFile(null)
            setEditorContentState('')
            setOriginalContent('')
            setIsSaved(true)
            setLoadedContentHash(undefined)
            setSaveConflict(null)
          }
        }
        return next
      })
    },
    [handleOpenFile],
  )

  const handleSaveFile = useCallback(async () => {
    const file = selectedFileRef.current
    if (!file || !window.electronAPI) return
    const draft = draftsRef.current.get(file.path)
    if (!draft?.isReady || draft.isSaved) return
    const res = await window.electronAPI.writeWorkspaceFile({
      filePath: file.path,
      content: draft.content,
      expectedContentHash: draft.contentHash,
      workspaceRoot: workspacePath || undefined,
    })
    if (!isMountedRef.current) return
    if (res.success) {
      const current = draftsRef.current.get(file.path)
      if (!current) return
      const hasNewerEdit = current.revision !== draft.revision || current.content !== draft.content
      replaceDraft(file, {
        ...current,
        originalContent: draft.content,
        contentHash: res.contentHash,
        isSaved: hasNewerEdit ? false : true,
        conflict: null,
      })
      onFileNotice(`Saved changes to ${file.name}`)
    } else if (res.conflict && res.currentContentHash && res.currentContent !== undefined) {
      const current = draftsRef.current.get(file.path)
      if (!current) return
      replaceDraft(file, {
        ...current,
        conflict: {
          filePath: file.path,
          fileName: file.name,
          localContent: draft.content,
          diskContent: res.currentContent,
          diskContentHash: res.currentContentHash,
        },
      })
    }
  }, [onFileNotice, replaceDraft, workspacePath])

  const handleReloadConflict = useCallback(() => {
    const file = selectedFileRef.current
    const draft = file && draftsRef.current.get(file.path)
    if (!file || !draft?.conflict) return
    replaceDraft(file, {
      ...draft,
      content: draft.conflict.diskContent,
      originalContent: draft.conflict.diskContent,
      contentHash: draft.conflict.diskContentHash,
      isSaved: true,
      isReady: true,
      revision: draft.revision + 1,
      conflict: null,
    })
    onFileNotice(`Reloaded ${draft.conflict.fileName} from disk`)
  }, [onFileNotice, replaceDraft])

  const handleMergeConflict = useCallback(() => {
    const file = selectedFileRef.current
    const draft = file && draftsRef.current.get(file.path)
    if (!file || !draft?.conflict) return
    replaceDraft(file, {
      ...draft,
      content: `<<<<<<< EDITOR\n${draft.conflict.localContent}\n=======\n${draft.conflict.diskContent}\n>>>>>>> DISK`,
      originalContent: draft.conflict.diskContent,
      contentHash: draft.conflict.diskContentHash,
      isSaved: false,
      isReady: true,
      revision: draft.revision + 1,
      conflict: null,
    })
    onFileNotice(`Prepared manual merge for ${draft.conflict.fileName}`)
  }, [onFileNotice, replaceDraft])

  const handleOverwriteConflict = useCallback(async () => {
    const file = selectedFileRef.current
    const draft = file && draftsRef.current.get(file.path)
    if (!file || !draft?.conflict || !window.electronAPI) return
    const conflict = draft.conflict
    const res = await window.electronAPI.writeWorkspaceFile({
      filePath: conflict.filePath,
      content: conflict.localContent,
      expectedContentHash: conflict.diskContentHash,
      workspaceRoot: workspacePath || undefined,
    })
    if (!isMountedRef.current) return
    if (res.success) {
      const current = draftsRef.current.get(file.path)
      if (!current) return
      const hasNewerEdit = current.revision !== draft.revision || current.content !== conflict.localContent
      replaceDraft(file, {
        ...current,
        content: hasNewerEdit ? current.content : conflict.localContent,
        originalContent: conflict.localContent,
        contentHash: res.contentHash,
        isSaved: !hasNewerEdit,
        conflict: null,
      })
      onFileNotice(`Overwrote ${conflict.fileName} after conflict confirmation`)
    } else if (res.conflict && res.currentContentHash && res.currentContent !== undefined) {
      const current = draftsRef.current.get(file.path)
      if (!current?.conflict) return
      replaceDraft(file, {
        ...current,
        conflict: {
          ...current.conflict,
          diskContent: res.currentContent,
          diskContentHash: res.currentContentHash,
        },
      })
    }
  }, [onFileNotice, replaceDraft, workspacePath])

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
    [onFileNotice],
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
        for (const path of draftsRef.current.keys()) {
          if (isInside(path)) draftsRef.current.delete(path)
        }
        const activeFile = selectedFileRef.current
        if (activeFile && isInside(activeFile.path)) {
          if (remaining.length > 0) {
            const nextFile = remaining[remaining.length - 1]
            queueMicrotask(() => handleOpenFile(nextFile))
          } else {
            selectionRevisionRef.current += 1
            selectedPathRef.current = null
            selectedFileRef.current = null
            setSelectedFile(null)
            setEditorContentState('')
            setOriginalContent('')
            setIsSaved(true)
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
    [workspacePath, handleOpenFile, loadWorkspaceFiles, onPathPurged],
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

  useEffect(() => window.electronAPI?.onWorkspaceFileDeleted?.((data) => purgeFileReferences(data.filePath)), [purgeFileReferences])

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onWorkspaceFileVersionChanged) return
    return api.onWorkspaceFileVersionChanged(async (event) => {
      const file = selectedFileRef.current
      const selectedPath = selectedPathRef.current
      const selectionRevision = selectionRevisionRef.current
      if (!file || !selectedPath || event.filePath.replace(/\\/g, '/').toLowerCase() !== selectedPath.replace(/\\/g, '/').toLowerCase()) return
      if (event.deleted) {
        purgeFileReferences(event.filePath)
        return
      }
      const beforeRead = draftsRef.current.get(selectedPath)
      if (!beforeRead || !event.contentHash || event.contentHash === beforeRead.contentHash) return

      const result = await api.readWorkspaceFile({ filePath: event.filePath })
      if (!result.success || result.content === undefined || !result.contentHash) return
      if (!isMountedRef.current || selectedPathRef.current !== selectedPath || selectionRevisionRef.current !== selectionRevision) return
      const current = draftsRef.current.get(selectedPath)
      if (!current) return
      if (current.isSaved) {
        replaceDraft(file, {
          ...current,
          content: result.content,
          originalContent: result.content,
          contentHash: result.contentHash,
          isReady: true,
          conflict: null,
        })
      } else {
        replaceDraft(file, {
          ...current,
          conflict: {
            filePath: event.filePath,
            fileName: file.name,
            localContent: current.content,
            diskContent: result.content,
            diskContentHash: result.contentHash,
          },
        })
      }
    })
  }, [purgeFileReferences, replaceDraft])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      selectionRevisionRef.current += 1
    }
  }, [])

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
    setIsSaved: setDraftSaved,
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
