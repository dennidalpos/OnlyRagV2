// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspaceProjects } from './useWorkspaceProjects'

describe('project registry recovery', () => {
  it('keeps a refused-mutation warning when an older successful operation settles, until retry', async () => {
    const retained = { path: '/retained', name: 'Retained', addedAt: '2026-10-06T00:00:00Z', lastOpenedAt: '2026-10-06T00:00:00Z' }
    let release!: (project: typeof retained) => void
    const list = vi.fn().mockResolvedValue([retained])
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      listProjects: list,
      renameProject: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            release = resolve
          }),
      ),
      removeProjectFromRegistry: vi.fn().mockResolvedValue(false),
    }
    let projects!: ReturnType<typeof useWorkspaceProjects>
    function Harness() {
      projects = useWorkspaceProjects()
      return null
    }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Harness />))
      let renaming!: Promise<void>
      act(() => {
        renaming = projects.handleRenameProject('/retained', 'Renamed')
      })
      await act(async () => projects.handleRemoveProject('/retained'))
      expect(projects.registryFailed).toBe(true)
      const renamed = { ...retained, name: 'Renamed' }
      list.mockResolvedValue([renamed])
      await act(async () => {
        release(renamed)
        await renaming
      })
      expect(projects.registryFailed).toBe(true)
      expect(projects.projects).toEqual([renamed])
      await act(async () => projects.retryRegistry())
      expect(projects.registryFailed).toBe(false)
    } finally {
      await act(async () => root.unmount())
    }
  })

  it('ignores an older registry load after acknowledged removal', async () => {
    const retained = { path: '/retained', name: 'Retained', addedAt: '2026-10-06T00:00:00Z', lastOpenedAt: '2026-10-06T00:00:00Z' }
    let release!: (list: (typeof retained)[]) => void
    const list = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve
          }),
      )
      .mockResolvedValue([])
    ;(window as unknown as { electronAPI: unknown }).electronAPI = { listProjects: list, removeProjectFromRegistry: vi.fn().mockResolvedValue(true) }
    let projects!: ReturnType<typeof useWorkspaceProjects>
    function Harness() {
      projects = useWorkspaceProjects()
      return null
    }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Harness />))
      await act(async () => projects.handleRemoveProject('/retained'))
      await act(async () => release([retained]))
      expect(projects.projects).toEqual([])
    } finally {
      await act(async () => root.unmount())
    }
  })

  it('does not reverse a newer selection when an earlier removal settles', async () => {
    const retained = ['a', 'b'].map((name) => ({ path: `/${name}`, name, addedAt: '2026-10-06T00:00:00Z', lastOpenedAt: '2026-10-06T00:00:00Z' }))
    let release!: (removed: boolean) => void
    const list = vi.fn().mockResolvedValue(retained)
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      listProjects: list,
      touchProject: vi.fn().mockResolvedValue(retained[1]),
      removeProjectFromRegistry: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            release = resolve
          }),
      ),
    }
    localStorage.setItem('onlyrag_last_workspace', '/a')
    let projects!: ReturnType<typeof useWorkspaceProjects>
    function Harness() {
      projects = useWorkspaceProjects()
      return null
    }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Harness />))
      let removal!: Promise<boolean>
      act(() => {
        removal = projects.handleRemoveProject('/a')
      })
      await act(async () => projects.handleSelectProject('/b'))
      list.mockResolvedValue([retained[1]])
      await act(async () => {
        release(true)
        await removal
      })
      expect(projects.workspacePath).toBe('/b')
      expect(projects.projects).toEqual([retained[1]])
    } finally {
      await act(async () => root.unmount())
      localStorage.clear()
    }
  })

  it.each(['rename', 'remove', 'register'] as const)('preserves acknowledged projects after a refused %s', async (operation) => {
    const retained = { path: '/retained', name: 'Retained', addedAt: '2026-10-06T00:00:00Z', lastOpenedAt: '2026-10-06T00:00:00Z' }
    const list = vi.fn().mockResolvedValue([retained])
    const api = {
      listProjects: list,
      renameProject: vi.fn().mockResolvedValue(null),
      removeProjectFromRegistry: vi.fn().mockResolvedValue(false),
      touchProject: vi.fn().mockResolvedValue(null),
      registerProject: vi.fn().mockRejectedValue(new Error('Write refused')),
    }
    ;(window as unknown as { electronAPI: unknown }).electronAPI = api
    let projects!: ReturnType<typeof useWorkspaceProjects>
    function Harness() {
      projects = useWorkspaceProjects()
      return null
    }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Harness />))
      await act(async () => {
        if (operation === 'rename') await projects.handleRenameProject('/retained', 'Unsaved')
        else if (operation === 'remove') await projects.handleRemoveProject('/retained')
        else projects.handleSelectProject('/unregistered')
      })
      expect(projects.projects).toEqual([retained])
      expect(projects.registryFailed).toBe(true)
    } finally {
      await act(async () => root.unmount())
      localStorage.clear()
    }
  })

  it('exposes unavailable registry and reloads it only after a successful retry', async () => {
    const list = vi.fn().mockRejectedValue(new Error('Retained registry unavailable'))
    ;(window as unknown as { electronAPI: unknown }).electronAPI = { listProjects: list }
    let projects: ReturnType<typeof useWorkspaceProjects> | undefined
    function Harness() {
      projects = useWorkspaceProjects()
      return null
    }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Harness />))
      expect(projects?.registryFailed).toBe(true)
      const retained = { path: '/retained', name: 'Retained', addedAt: '2026-10-06T00:00:00Z', lastOpenedAt: '2026-10-06T00:00:00Z' }
      list.mockResolvedValue([retained])
      await act(async () => projects?.retryRegistry())
      expect(projects?.registryFailed).toBe(false)
      expect(projects?.projects).toEqual([retained])
    } finally {
      await act(async () => root.unmount())
    }
  })
})
