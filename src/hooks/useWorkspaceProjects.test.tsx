// @vitest-environment happy-dom
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspaceProjects } from './useWorkspaceProjects'

describe('standalone selection ownership', () => {
  it.each(['current', 'new-selection', 'second-dialog', 'unmount'] as const)('applies only the owned directory chooser: %s', async (scenario) => {
    const releases: ((path: string) => void)[] = []
    const touch = vi.fn().mockResolvedValue({ path: '/chosen' })
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      listProjects: vi.fn().mockResolvedValue([]),
      touchProject: touch,
      openDirectoryDialog: vi.fn().mockImplementation(() => new Promise((resolve) => releases.push(resolve))),
    }
    localStorage.clear()
    let projects!: ReturnType<typeof useWorkspaceProjects>
    function Harness() {
      projects = useWorkspaceProjects()
      return null
    }
    const root = createRoot(document.createElement('div'))
    let unmounted = false
    try {
      await act(async () => root.render(<Harness />))
      let first!: Promise<void>
      act(() => {
        first = projects.handleAddProject()
      })
      if (scenario === 'new-selection') await act(async () => projects.handleSelectProject('/newer'))
      if (scenario === 'second-dialog')
        act(() => {
          void projects.handleAddProject()
        })
      if (scenario === 'unmount') {
        await act(async () => root.unmount())
        unmounted = true
      }
      await act(async () => {
        releases[0]('/chosen')
        await first
      })
      if (scenario === 'current') expect(projects.workspacePath).toBe('/chosen')
      else if (scenario === 'new-selection') expect(projects.workspacePath).toBe('/newer')
      else expect(touch).not.toHaveBeenCalled()
      if (scenario === 'second-dialog') {
        await act(async () => releases[1]('/second'))
        expect(projects.workspacePath).toBe('/second')
      }
    } finally {
      if (!unmounted) await act(async () => root.unmount())
      localStorage.clear()
    }
  })

  it.each(['startup', 'selection', 'toggle', 'removal', 'reselection', 'unmount', 'strict'] as const)(
    'keeps the current workspace after delayed scratch initialization: %s',
    async (scenario) => {
      const project = { path: '/project', name: 'Project', addedAt: '2026-10-06T00:00:00Z', lastOpenedAt: '2026-10-06T00:00:00Z' }
      const releases: ((value: { path: string }) => void)[] = []
      const scratch = vi.fn().mockImplementation(() => new Promise((resolve) => releases.push(resolve)))
      ;(window as unknown as { electronAPI: unknown }).electronAPI = {
        listProjects: vi.fn().mockResolvedValue([]),
        touchProject: vi.fn().mockResolvedValue(project),
        removeProjectFromRegistry: vi.fn().mockResolvedValue(true),
        getStandaloneScratchWorkspace: scratch,
      }
      localStorage.clear()
      let projects!: ReturnType<typeof useWorkspaceProjects>
      function Harness() {
        projects = useWorkspaceProjects({ noWorkspaceMode: ['startup', 'strict', 'unmount'].includes(scenario) } as Parameters<typeof useWorkspaceProjects>[0])
        return <span>{projects.workspacePath}</span>
      }
      const container = document.createElement('div')
      const root = createRoot(container)
      let unmounted = false
      try {
        await act(async () =>
          root.render(
            scenario === 'strict' ? (
              <StrictMode>
                <Harness />
              </StrictMode>
            ) : (
              <Harness />
            ),
          ),
        )
        if (scenario === 'selection' || scenario === 'reselection') await act(async () => projects.handleSelectProject(null))
        if (scenario === 'toggle') {
          await act(async () => projects.handleSelectProject('/project'))
          await act(async () => projects.handleToggleStandalone())
        }
        if (scenario === 'removal') {
          await act(async () => projects.handleSelectProject('/project'))
          await act(async () => projects.handleRemoveProject('/project'))
        }
        expect(releases.length).toBeGreaterThan(0)
        const originalRequests = [...releases]
        if (scenario === 'unmount') {
          await act(async () => root.unmount())
          unmounted = true
          await act(async () => originalRequests.forEach((release) => release({ path: '/scratch' })))
          expect(projects.standaloneWorkspacePath).toBeNull()
          expect(container.textContent).toBe('')
        } else if (scenario === 'strict') {
          expect(releases.length).toBe(2)
          await act(async () => releases[0]({ path: '/stale-scratch' }))
          expect(projects.workspacePath).toBeNull()
          await act(async () => releases[1]({ path: '/scratch' }))
          expect(projects.workspacePath).toBe('/scratch')
          expect(projects.standaloneWorkspacePath).toBe('/scratch')
        } else {
          await act(async () => projects.handleSelectProject('/project'))
          if (scenario === 'reselection') {
            await act(async () => projects.handleSelectProject(null))
            await act(async () => originalRequests.forEach((release) => release({ path: '/stale-scratch' })))
            expect(projects.workspacePath).toBeNull()
            await act(async () => releases.slice(originalRequests.length).forEach((release) => release({ path: '/scratch' })))
            expect(projects.workspacePath).toBe('/scratch')
            expect(projects.isStandaloneMode).toBe(true)
          } else {
            await act(async () => originalRequests.forEach((release) => release({ path: '/scratch' })))
            expect(projects.workspacePath).toBe('/project')
            expect(projects.isStandaloneMode).toBe(false)
            expect(localStorage.getItem('onlyrag_last_workspace')).toBe('/project')
          }
        }
      } finally {
        if (!unmounted) await act(async () => root.unmount())
        localStorage.clear()
      }
    },
  )
})

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
