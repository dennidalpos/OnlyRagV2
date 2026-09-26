import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceFile } from '../types'
import { useWorkspaceFiles } from './useWorkspaceFiles'

const file = (name: string): WorkspaceFile => ({ name, path: `/repo/${name}`, isDir: false }) as WorkspaceFile

describe('useWorkspaceFiles', () => {
  let root: Root
  let workspace: ReturnType<typeof useWorkspaceFiles>
  const pendingReads = new Map<string, (content: string) => void>()
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
    ;(window as unknown as { electronAPI: unknown }).electronAPI = { readWorkspaceFile, listWorkspaceFiles: vi.fn().mockResolvedValue([]) }
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
})
