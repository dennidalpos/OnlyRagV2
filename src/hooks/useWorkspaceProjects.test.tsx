// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspaceProjects } from './useWorkspaceProjects'

describe('project registry recovery', () => {
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
