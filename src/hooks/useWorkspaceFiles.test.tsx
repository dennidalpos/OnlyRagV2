import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceFile } from '../types'
import { useWorkspaceFiles } from './useWorkspaceFiles'

const file = (name: string): WorkspaceFile => ({ name, path: `/repo/${name}`, isDir: false }) as WorkspaceFile

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('useWorkspaceFiles', () => {
  let root: Root
  let workspace: ReturnType<typeof useWorkspaceFiles>
  const pendingReads = new Map<string, (content: string) => void>()
  let listWorkspaceFiles: ReturnType<typeof vi.fn>
  let writeWorkspaceFile: ReturnType<typeof vi.fn>
  let versionHandler: ((event: { filePath: string; contentHash?: string; deleted?: boolean }) => Promise<void>) | undefined
  const readWorkspaceFile = vi.fn(
    ({ filePath }: { filePath: string }) =>
      new Promise((resolve) => {
        pendingReads.set(filePath, (content) => resolve({ success: true, content, contentHash: `hash:${content}` }))
      }),
  )

  function Harness() {
    workspace = useWorkspaceFiles({ workspacePath: '/repo', isStandaloneMode: false, onFileNotice: vi.fn(), onPathPurged: vi.fn() })
    return null
  }

  beforeEach(async () => {
    pendingReads.clear()
    readWorkspaceFile.mockClear()
    listWorkspaceFiles = vi.fn().mockResolvedValue([])
    writeWorkspaceFile = vi.fn().mockResolvedValue({ success: true, contentHash: 'saved' })
    versionHandler = undefined
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      readWorkspaceFile,
      listWorkspaceFiles,
      writeWorkspaceFile,
      onWorkspaceFileVersionChanged: vi.fn((handler) => {
        versionHandler = handler
        return () => {}
      }),
    }
    root = createRoot(document.createElement('div'))
    await act(async () => root.render(<Harness />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
  })

  it('ignores a slow read of a file the user already switched away from', async () => {
    const slow = file('slow.ts')
    const fast = file('fast.ts')

    await act(async () => {
      void workspace.handleOpenFile(slow)
      void workspace.handleOpenFile(fast)
    })
    await act(async () => pendingReads.get(fast.path)?.('// fast'))
    await act(async () => pendingReads.get(slow.path)?.('// slow'))

    expect(workspace.selectedFile?.path).toBe(fast.path)
    expect(workspace.editorContent).toBe('// fast')
    expect(workspace.loadedContentHash).toBe('hash:// fast')
  })

  it('keeps newer edits dirty when an earlier save completes', async () => {
    const target = file('a.ts')
    await act(async () => void workspace.handleOpenFile(target))
    await act(async () => pendingReads.get(target.path)?.('original'))
    await act(async () => {
      workspace.setEditorContent('first')
      workspace.setIsSaved(false)
    })
    const save = deferred<{ success: true; contentHash: string }>()
    writeWorkspaceFile.mockReturnValueOnce(save.promise)
    await act(async () => void workspace.handleSaveFile())
    await act(async () => {
      workspace.setEditorContent('second')
      workspace.setIsSaved(false)
    })
    await act(async () => save.resolve({ success: true, contentHash: 'hash:first' }))

    expect(workspace.editorContent).toBe('second')
    expect(workspace.originalContent).toBe('first')
    expect(workspace.isSaved).toBe(false)
  })

  it('does not let a completed save update another selected file', async () => {
    const first = file('a.ts')
    const second = file('b.ts')
    await act(async () => void workspace.handleOpenFile(first))
    await act(async () => pendingReads.get(first.path)?.('a'))
    await act(async () => {
      workspace.setEditorContent('edited a')
      workspace.setIsSaved(false)
    })
    const save = deferred<{ success: true; contentHash: string }>()
    writeWorkspaceFile.mockReturnValueOnce(save.promise)
    await act(async () => void workspace.handleSaveFile())
    await act(async () => void workspace.handleOpenFile(second))
    await act(async () => pendingReads.get(second.path)?.('b'))
    await act(async () => save.resolve({ success: true, contentHash: 'hash:a' }))

    expect(workspace.selectedFile?.path).toBe(second.path)
    expect(workspace.originalContent).toBe('b')
  })

  it('retains a dirty draft while switching and closing tabs', async () => {
    const first = file('a.ts')
    const second = file('b.ts')
    await act(async () => void workspace.handleOpenFile(first))
    await act(async () => pendingReads.get(first.path)?.('a'))
    await act(async () => {
      workspace.setEditorContent('draft a')
      workspace.setIsSaved(false)
      void workspace.handleOpenFile(second)
    })
    await act(async () => pendingReads.get(second.path)?.('b'))
    await act(async () => void workspace.handleOpenFile(first))
    expect(workspace.editorContent).toBe('draft a')

    await act(async () => workspace.handleCloseFile(first))
    await act(async () => void workspace.handleOpenFile(first))
    expect(workspace.editorContent).toBe('draft a')
  })

  it('does not save the previous buffer while the next file is loading', async () => {
    const first = file('a.ts')
    const second = file('b.ts')
    await act(async () => void workspace.handleOpenFile(first))
    await act(async () => pendingReads.get(first.path)?.('a'))
    await act(async () => {
      workspace.setEditorContent('draft a')
      workspace.setIsSaved(false)
      void workspace.handleOpenFile(second)
      void workspace.handleSaveFile()
    })

    expect(writeWorkspaceFile).not.toHaveBeenCalled()
    await act(async () => pendingReads.get(second.path)?.('b'))
  })

  it('ignores a delayed version read after selection changes', async () => {
    const first = file('a.ts')
    const second = file('b.ts')
    await act(async () => void workspace.handleOpenFile(first))
    await act(async () => pendingReads.get(first.path)?.('a'))
    const external = deferred<{ success: true; content: string; contentHash: string }>()
    readWorkspaceFile.mockReturnValueOnce(external.promise)
    await act(async () => void versionHandler?.({ filePath: first.path, contentHash: 'external' }))
    await act(async () => void workspace.handleOpenFile(second))
    await act(async () => pendingReads.get(second.path)?.('b'))
    await act(async () => external.resolve({ success: true, content: 'external a', contentHash: 'external' }))

    expect(workspace.selectedFile?.path).toBe(second.path)
    expect(workspace.editorContent).toBe('b')
  })

  it('preserves a dirty draft and reports a conflict for the matching external version', async () => {
    const target = file('a.ts')
    await act(async () => void workspace.handleOpenFile(target))
    await act(async () => pendingReads.get(target.path)?.('original'))
    await act(async () => {
      workspace.setEditorContent('local draft')
      workspace.setIsSaved(false)
    })
    const external = deferred<{ success: true; content: string; contentHash: string }>()
    readWorkspaceFile.mockReturnValueOnce(external.promise)
    await act(async () => void versionHandler?.({ filePath: target.path, contentHash: 'external' }))
    await act(async () => external.resolve({ success: true, content: 'disk version', contentHash: 'external' }))

    expect(workspace.editorContent).toBe('local draft')
    expect(workspace.saveConflict).toMatchObject({ filePath: target.path, diskContent: 'disk version', localContent: 'local draft' })
  })

  it('keeps the most recent workspace listing', async () => {
    const oldListing = deferred<WorkspaceFile[]>()
    listWorkspaceFiles.mockReturnValueOnce(oldListing.promise)
    await act(async () => void workspace.loadWorkspaceFiles('/old'))
    listWorkspaceFiles.mockResolvedValueOnce([file('new.ts')])
    await act(async () => workspace.loadWorkspaceFiles('/new'))
    await act(async () => oldListing.resolve([file('old.ts')]))

    expect(workspace.files.map((entry) => entry.name)).toEqual(['new.ts'])
  })

  it('allows a failed read to retry without replacing a typed draft', async () => {
    const target = file('a.ts')
    readWorkspaceFile.mockRejectedValueOnce(new Error('temporary'))
    await act(async () => workspace.handleOpenFile(target))
    expect(workspace.editorContent).toContain('temporary')

    await act(async () => void workspace.handleOpenFile(target))
    await act(async () => pendingReads.get(target.path)?.('retried'))
    expect(workspace.editorContent).toBe('retried')
  })

  it('ignores a pending file read after unmount', async () => {
    const target = file('a.ts')
    await act(async () => void workspace.handleOpenFile(target))
    await act(async () => root.unmount())
    await act(async () => pendingReads.get(target.path)?.('late'))

    expect(workspace.editorContent).toBe('')
  })
})
