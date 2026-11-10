import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSkillHubModal } from './useSkillHubModal'
import type { HubSkillItem, SkillDefinition } from '../types'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const installed = (name: string) => [{ id: name, name, isActive: true } as SkillDefinition]
const hub = (name: string) => [{ id: name, name, isInstalled: false } as unknown as HubSkillItem]

describe('useSkillHubModal ownership of asynchronous results', () => {
  let container: HTMLDivElement
  let root: Root
  let state: ReturnType<typeof useSkillHubModal>
  const api = {
    listInstalledSkills: vi.fn(),
    listHubSources: vi.fn(),
    listHubSkillsAcrossSources: vi.fn(),
    listHubSkillsBySource: vi.fn(),
    installSkillFromHub: vi.fn(),
  }

  function Harness({ open, workspace }: { open: boolean; workspace: string | null }) {
    state = useSkillHubModal(open, workspace, () => {})
    return (
      <div>
        <p id="installed">{state.installedSkills.map((s) => s.name).join(',')}</p>
        <p id="hub">{state.hubSkills.map((s) => s.name).join(',')}</p>
        <p id="loading">{String(state.isLoading)}</p>
        <p id="installing">{String(state.installingSkillId)}</p>
        <p id="message">{state.actionMessage ? `${state.actionMessage.type}:${state.actionMessage.text}` : ''}</p>
      </div>
    )
  }
  const text = (id: string) => container.querySelector(`#${id}`)!.textContent
  const render = (open: boolean, workspace: string | null) => act(async () => root.render(<Harness open={open} workspace={workspace} />))

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.clearAllMocks()
    api.listHubSources.mockResolvedValue([])
    Object.assign(window, { electronAPI: api })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
  })

  it('ignores a delayed response of the previous workspace after the new one has loaded', async () => {
    const slowInstalledA = deferred<SkillDefinition[]>()
    const slowHubA = deferred<HubSkillItem[]>()
    api.listInstalledSkills.mockImplementation(({ workspaceRoot }: { workspaceRoot?: string }) =>
      workspaceRoot === 'A' ? slowInstalledA.promise : Promise.resolve(installed('B-skill')),
    )
    api.listHubSkillsAcrossSources.mockImplementation(({ workspaceRoot }: { workspaceRoot?: string }) =>
      workspaceRoot === 'A' ? slowHubA.promise : Promise.resolve(hub('B-hub')),
    )

    await render(true, 'A')
    await render(true, 'B')
    expect(text('installed')).toBe('B-skill')
    expect(text('hub')).toBe('B-hub')

    await act(async () => {
      slowInstalledA.resolve(installed('A-skill'))
      slowHubA.resolve(hub('A-hub'))
    })
    expect(text('installed')).toBe('B-skill')
    expect(text('hub')).toBe('B-hub')
    expect(text('loading')).toBe('false')
  })

  it('does not show a late failure of the previous workspace or clear the current loading state', async () => {
    const lateFailure = deferred<SkillDefinition[]>()
    const slowB = deferred<SkillDefinition[]>()
    api.listInstalledSkills.mockImplementation(({ workspaceRoot }: { workspaceRoot?: string }) => (workspaceRoot === 'A' ? lateFailure.promise : slowB.promise))
    api.listHubSkillsAcrossSources.mockResolvedValue([])

    await render(true, 'A')
    await render(true, 'B')
    await act(async () => lateFailure.reject(new Error('A failed late')))
    expect(text('message')).toBe('')
    expect(text('loading')).toBe('true')

    await act(async () => slowB.resolve(installed('B-skill')))
    expect(text('installed')).toBe('B-skill')
    expect(text('loading')).toBe('false')
  })

  it('keeps the latest source selection when responses arrive out of order', async () => {
    api.listInstalledSkills.mockResolvedValue([])
    api.listHubSkillsAcrossSources.mockResolvedValue([])
    const slowX = deferred<HubSkillItem[]>()
    const fastY = deferred<HubSkillItem[]>()
    api.listHubSkillsBySource.mockImplementation(({ sourceId }: { sourceId: string }) => (sourceId === 'X' ? slowX.promise : fastY.promise))

    await render(true, 'A')
    let first!: Promise<void>
    let second!: Promise<void>
    await act(async () => {
      first = state.handleSourceChange('X')
      second = state.handleSourceChange('Y')
    })
    await act(async () => fastY.resolve(hub('Y-hub')))
    await second
    expect(text('hub')).toBe('Y-hub')
    expect(text('loading')).toBe('false')

    await act(async () => slowX.resolve(hub('X-hub')))
    await first
    expect(text('hub')).toBe('Y-hub')
    expect(state.selectedSourceId).toBe('Y')
  })

  it('sends an in-flight install to its own workspace and drops its result after a workspace switch', async () => {
    api.listInstalledSkills.mockResolvedValue([])
    api.listHubSkillsAcrossSources.mockResolvedValue([])
    const install = deferred<{ success: boolean }>()
    api.installSkillFromHub.mockReturnValue(install.promise)

    await render(true, 'A')
    let pending!: Promise<void>
    await act(async () => {
      pending = state.handleInstallFromHub('tool')
    })
    expect(api.installSkillFromHub).toHaveBeenCalledWith(expect.objectContaining({ workspaceRoot: 'A' }))
    expect(text('installing')).toBe('tool')

    await render(true, 'B')
    expect(text('installing')).toBe('null')
    await act(async () => install.resolve({ success: true }))
    await pending
    expect(text('message')).toBe('')
    expect(text('installing')).toBe('null')
    expect(api.listInstalledSkills.mock.calls.filter(([arg]) => arg.workspaceRoot === 'A').length).toBe(1)
  })

  it('drops responses that arrive after the modal was closed and reopened', async () => {
    const stale = deferred<SkillDefinition[]>()
    api.listHubSkillsAcrossSources.mockResolvedValue([])
    api.listInstalledSkills.mockReturnValueOnce(stale.promise).mockResolvedValue(installed('fresh'))

    await render(true, 'A')
    await render(false, 'A')
    await render(true, 'A')
    expect(text('installed')).toBe('fresh')
    await act(async () => stale.resolve(installed('stale')))
    expect(text('installed')).toBe('fresh')
    expect(text('loading')).toBe('false')
  })
})
