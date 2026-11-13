import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceFile } from '../types'
import { useWorkspaceFiles } from './useWorkspaceFiles'
import { logger } from '../lib/logger'
import { useWorkspaceProjects } from './useWorkspaceProjects'

const file = (name: string): WorkspaceFile => ({ name, path: `/repo/${name}`, isDir: false }) as WorkspaceFile

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
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

  const container = document.createElement('div')
  function Harness({ path = '/repo', standalone = false }: { path?: string | null; standalone?: boolean }) {
    workspace = useWorkspaceFiles({ workspacePath: path, isStandaloneMode: standalone, onFileNotice: vi.fn(), onPathPurged: vi.fn() })
    return (
      <span>
        {workspace.files.length}:{workspace.editorContent}
      </span>
    )
  }

  async function switchWorkspace(path: string | null, standalone = false) {
    await act(async () => root.render(<Harness path={path} standalone={standalone} />))
  }

  async function edit(target: WorkspaceFile, content: string) {
    await act(async () => void workspace.handleOpenFile(target))
    await act(async () => pendingReads.get(target.path)?.(`disk:${target.name}`))
    await act(async () => workspace.setEditorContent(content))
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
    root = createRoot(container)
    await act(async () => root.render(<Harness />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    vi.restoreAllMocks()
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

  it('retains multiple dirty files and a closed tab across A to B to A', async () => {
    const first = file('a.ts')
    const second = file('b.ts')
    await edit(first, 'draft A1')
    await edit(second, 'draft A2')
    await act(async () => workspace.handleCloseFile(first))
    await switchWorkspace('/other')
    const other = { ...first, path: '/other/a.ts' }
    await edit(other, 'draft B')
    await switchWorkspace('/repo')
    expect(workspace.selectedFile).toBeNull()
    await act(async () => workspace.handleOpenFile(first))
    expect(workspace.editorContent).toBe('draft A1')
    expect(workspace.originalContent).toBe('disk:a.ts')
    expect(workspace.loadedContentHash).toBe('hash:disk:a.ts')
    expect(workspace.isSaved).toBe(false)
    await act(async () => workspace.handleOpenFile(second))
    expect(workspace.editorContent).toBe('draft A2')
    await switchWorkspace('/other')
    await act(async () => workspace.handleOpenFile(other))
    expect(workspace.editorContent).toBe('draft B')
    expect(writeWorkspaceFile).not.toHaveBeenCalled()
  })

  it.each(['detach', 'reset', 'standalone', 'purge'] as const)('preserves a dirty buffer through %s', async (scenario) => {
    const target = file('a.ts')
    await edit(target, 'keep this text')
    if (scenario === 'detach') await switchWorkspace(null)
    if (scenario === 'reset') await act(async () => workspace.resetWorkspaceFiles())
    if (scenario === 'standalone') {
      await switchWorkspace('/scratch', true)
      await edit({ ...target, path: '/scratch/a.ts' }, 'scratch draft')
    }
    if (scenario === 'purge') await act(async () => workspace.purgeFileReferences('/repo'))
    await switchWorkspace('/repo')
    await act(async () => workspace.handleOpenFile(target))
    expect(workspace.editorContent).toBe('keep this text')
    expect(workspace.isSaved).toBe(false)
    if (scenario === 'standalone') {
      await switchWorkspace('/scratch', true)
      await act(async () => workspace.handleOpenFile({ ...target, path: '/scratch/a.ts' }))
      expect(workspace.editorContent).toBe('scratch draft')
    }
  })

  it.each(['failure', 'rejection', 'conflict', 'success'] as const)('keeps the correct draft after a detached save: %s', async (outcome) => {
    const target = file('a.ts')
    await edit(target, 'local edit')
    const save = deferred<{ success: boolean; contentHash?: string; conflict?: boolean; currentContent?: string; currentContentHash?: string }>()
    writeWorkspaceFile.mockReturnValueOnce(save.promise)
    let saving!: Promise<void>
    await act(async () => {
      saving = workspace.handleSaveFile()
      void saving.catch(() => {})
    })
    await switchWorkspace('/other')
    await act(async () => {
      if (outcome === 'rejection') save.reject(new Error('write failed'))
      else
        save.resolve(
          outcome === 'conflict'
            ? { success: false, conflict: true, currentContent: 'external edit', currentContentHash: 'external' }
            : { success: outcome === 'success', contentHash: 'saved' },
        )
      await saving.catch(() => {})
    })
    expect(workspace.selectedFile).toBeNull()
    expect(workspace.saveConflict).toBeNull()
    await switchWorkspace('/repo')
    if (outcome === 'success') {
      await act(async () => void workspace.handleOpenFile(target))
      await act(async () => pendingReads.get(target.path)?.('local edit'))
    } else await act(async () => workspace.handleOpenFile(target))
    expect(workspace.editorContent).toBe('local edit')
    expect(workspace.isSaved).toBe(outcome === 'success')
    if (outcome === 'conflict') {
      expect(workspace.saveConflict).toMatchObject({ localContent: 'local edit', diskContent: 'external edit', diskContentHash: 'external' })
      await switchWorkspace('/other')
      await switchWorkspace('/repo')
      await act(async () => workspace.handleOpenFile(target))
      expect(workspace.saveConflict?.diskContentHash).toBe('external')
    }
  })

  it('uses the retained disk hash to detect a change made while the workspace was detached', async () => {
    const target = file('a.ts')
    await edit(target, 'local edit')
    await switchWorkspace('/other')
    await switchWorkspace('/repo')
    await act(async () => workspace.handleOpenFile(target))
    writeWorkspaceFile.mockResolvedValueOnce({ success: false, conflict: true, currentContent: 'changed on disk', currentContentHash: 'changed' })
    await act(async () => workspace.handleSaveFile())
    expect(writeWorkspaceFile).toHaveBeenCalledWith({
      filePath: target.path,
      content: 'local edit',
      expectedContentHash: 'hash:disk:a.ts',
      workspaceRoot: '/repo',
    })
    expect(workspace.editorContent).toBe('local edit')
    expect(workspace.saveConflict?.diskContent).toBe('changed on disk')
  })

  it.each(['detach', 'reset', 'null-load', 'standalone', 'unmount'] as const)('invalidates a pending listing on %s', async (scenario) => {
    const listing = deferred<WorkspaceFile[]>()
    listWorkspaceFiles.mockReturnValueOnce(listing.promise)
    await act(async () => void workspace.loadWorkspaceFiles('/repo'))
    if (scenario === 'detach') await switchWorkspace(null)
    if (scenario === 'reset') await act(async () => workspace.resetWorkspaceFiles())
    if (scenario === 'null-load') await act(async () => workspace.loadWorkspaceFiles(null))
    if (scenario === 'standalone') await switchWorkspace('/scratch', true)
    if (scenario === 'unmount') await act(async () => root.unmount())
    await act(async () => listing.resolve([file('late.ts')]))
    expect(workspace.files).toEqual([])
    expect(container.textContent).toBe(scenario === 'unmount' ? '' : `0:${workspace.editorContent}`)
  })

  it('keeps the new A listing after A to B to A replies arrive out of order', async () => {
    const oldA = deferred<WorkspaceFile[]>()
    const oldB = deferred<WorkspaceFile[]>()
    listWorkspaceFiles.mockReturnValueOnce(oldA.promise)
    await act(async () => void workspace.loadWorkspaceFiles('/repo'))
    listWorkspaceFiles.mockReturnValueOnce(oldB.promise)
    await switchWorkspace('/other')
    listWorkspaceFiles.mockResolvedValueOnce([file('current.ts')])
    await switchWorkspace('/repo')
    await act(async () => {
      oldB.resolve([file('old-b.ts')])
      oldA.resolve([file('old-a.ts')])
    })
    expect(workspace.files.map((entry) => entry.name)).toEqual(['current.ts'])
    expect(container.textContent).toContain('1:')
  })

  it.each(['detach', 'new-request', 'unmount'] as const)('ignores a stale listing failure after %s', async (scenario) => {
    const warning = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const listing = deferred<WorkspaceFile[]>()
    listWorkspaceFiles.mockReturnValueOnce(listing.promise)
    await act(async () => void workspace.loadWorkspaceFiles('/repo'))
    if (scenario === 'detach') await switchWorkspace(null)
    if (scenario === 'new-request') {
      listWorkspaceFiles.mockResolvedValueOnce([file('current.ts')])
      await act(async () => workspace.loadWorkspaceFiles('/repo'))
    }
    if (scenario === 'unmount') await act(async () => root.unmount())
    await act(async () => listing.reject(new Error('late failure')))
    expect(warning).not.toHaveBeenCalled()
    expect(workspace.files).toHaveLength(scenario === 'new-request' ? 1 : 0)
  })

  it('reports a current listing failure and allows retry', async () => {
    const warning = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    listWorkspaceFiles.mockRejectedValueOnce(new Error('current failure'))
    await act(async () => workspace.loadWorkspaceFiles('/repo'))
    expect(warning).toHaveBeenCalledWith('useWorkspaceFiles', expect.stringContaining('current failure'))
    listWorkspaceFiles.mockResolvedValueOnce([file('retried.ts')])
    await act(async () => workspace.loadWorkspaceFiles('/repo'))
    expect(workspace.files[0].name).toBe('retried.ts')
  })

  it('reloads a saved buffer from disk when returning to a workspace', async () => {
    const target = file('a.ts')
    await act(async () => void workspace.handleOpenFile(target))
    await act(async () => pendingReads.get(target.path)?.('old disk content'))
    await switchWorkspace('/other')
    await switchWorkspace('/repo')
    await act(async () => void workspace.handleOpenFile(target))
    await act(async () => pendingReads.get(target.path)?.('new disk content'))
    expect(workspace.editorContent).toBe('new disk content')
    expect(workspace.isSaved).toBe(true)
  })

  it('ignores the previous visit read after returning to the same file', async () => {
    const target = file('a.ts')
    const stale = deferred<{ success: true; content: string; contentHash: string }>()
    readWorkspaceFile.mockReturnValueOnce(stale.promise)
    await act(async () => void workspace.handleOpenFile(target))
    await switchWorkspace('/other')
    await switchWorkspace('/repo')
    await edit(target, 'new visit draft')
    await act(async () => stale.resolve({ success: true, content: 'stale read', contentHash: 'stale' }))
    expect(workspace.editorContent).toBe('new visit draft')
    expect(workspace.loadedContentHash).toBe('hash:disk:a.ts')
  })

  it.each(['close', 'purge'] as const)('does not reopen a queued tab after reset: %s', async (operation) => {
    const first = file('a.ts')
    const second = file('b.ts')
    await edit(first, 'first draft')
    await edit(second, 'second draft')
    const queued: VoidFunction[] = []
    vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => queued.push(callback))
    await act(async () => {
      if (operation === 'close') workspace.handleCloseFile(second)
      else workspace.purgeFileReferences(second.path)
    })
    expect(queued.length).toBeGreaterThan(0)
    await act(async () => workspace.resetWorkspaceFiles())
    await act(async () => queued.forEach((callback) => callback()))
    expect(workspace.selectedFile).toBeNull()
    expect(workspace.openFiles).toEqual([])
    await act(async () => workspace.handleOpenFile(first))
    expect(workspace.editorContent).toBe('first draft')
  })
})

describe('workspace project transitions with editor drafts', () => {
  it.each(['remove', 'failed-removal', 'cancel-chooser', 'standalone'] as const)('preserves text through the project hook: %s', async (scenario) => {
    const target = file('draft.ts')
    const api = {
      listProjects: vi.fn().mockResolvedValue([]),
      readWorkspaceFile: vi.fn().mockResolvedValue({ success: true, content: 'original', contentHash: 'original-hash' }),
      writeWorkspaceFile: vi.fn(),
      listWorkspaceFiles: vi.fn().mockResolvedValue([target]),
      touchProject: vi.fn().mockResolvedValue({ path: '/repo' }),
      removeProjectFromRegistry: vi.fn().mockResolvedValue(scenario !== 'failed-removal'),
      openDirectoryDialog: vi.fn().mockResolvedValue(null),
      getStandaloneScratchWorkspace: vi.fn().mockResolvedValue({ path: '/scratch' }),
    }
    ;(window as unknown as { electronAPI: unknown }).electronAPI = api
    localStorage.clear()
    let projects!: ReturnType<typeof useWorkspaceProjects>
    let workspace!: ReturnType<typeof useWorkspaceFiles>
    function Harness() {
      projects = useWorkspaceProjects({ customWorkspacePath: '/repo' } as Parameters<typeof useWorkspaceProjects>[0])
      workspace = useWorkspaceFiles({
        workspacePath: projects.workspacePath,
        isStandaloneMode: projects.isStandaloneMode,
        onFileNotice: vi.fn(),
        onPathPurged: vi.fn(),
      })
      return <span>{workspace.editorContent}</span>
    }
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Harness />))
      await act(async () => workspace.handleOpenFile(target))
      await act(async () => workspace.setEditorContent('retained draft'))
      if (scenario === 'cancel-chooser') {
        await act(async () => projects.handleAddProject())
        expect(projects.workspacePath).toBe('/repo')
        expect(container.textContent).toBe('retained draft')
      } else if (scenario === 'standalone') {
        await act(async () => projects.handleSelectProject(null))
        expect(projects.workspacePath).toBe('/scratch')
      } else {
        await act(async () => {
          expect(await projects.handleRemoveProject('/repo')).toBe(scenario === 'remove')
        })
        expect(projects.workspacePath).toBe(scenario === 'remove' ? '/scratch' : '/repo')
      }
      await act(async () => projects.handleSelectProject('/repo'))
      await act(async () => workspace.handleOpenFile(target))
      expect(container.textContent).toBe('retained draft')
      expect(workspace.isSaved).toBe(false)
      expect(workspace.loadedContentHash).toBe('original-hash')
      expect(api.writeWorkspaceFile).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      localStorage.clear()
    }
  })
})
