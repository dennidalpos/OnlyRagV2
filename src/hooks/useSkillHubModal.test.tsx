import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useSkillHubModal } from './useSkillHubModal'
import type { SkillDefinition } from '../types'

it('preserves the displayed activation on failure and permits retry and reread', async () => {
  const previous = window.electronAPI
  let active = true
  const toggle = vi
    .fn()
    .mockResolvedValueOnce(false)
    .mockImplementation(async () => {
      active = false
      return true
    })
  window.electronAPI = {
    listInstalledSkills: async () => [{ id: 'fixture', name: 'fixture', isActive: active } as SkillDefinition],
    listHubSources: async () => [],
    listHubSkillsAcrossSources: async () => [],
    toggleSkillActive: toggle,
  } as unknown as typeof window.electronAPI
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  let state: ReturnType<typeof useSkillHubModal>
  function Harness({ open }: { open: boolean }) {
    state = useSkillHubModal(open, null, () => {})
    return (
      <div>
        {state.installedSkills.map((s) => (
          <button key={s.id} onClick={() => state.handleToggleActive(s.id, s.isActive)}>
            {s.isActive ? 'active' : 'inactive'}
          </button>
        ))}
        <p role="alert">{state.actionMessage?.text}</p>
      </div>
    )
  }
  try {
    await act(async () => root.render(<Harness open />))
    await act(async () => container.querySelector('button')!.click())
    expect(container.querySelector('button')!.textContent).toBe('active')
    expect(container.querySelector('[role="alert"]')!.textContent).not.toBe('')
    await act(async () => container.querySelector('button')!.click())
    expect(container.querySelector('button')!.textContent).toBe('inactive')
    await act(async () => root.render(<Harness open={false} />))
    await act(async () => root.render(<Harness open />))
    expect(container.querySelector('button')!.textContent).toBe('inactive')
  } finally {
    await act(async () => root.unmount())
    container.remove()
    window.electronAPI = previous
  }
})
