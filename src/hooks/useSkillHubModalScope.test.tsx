import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSkillHubModal } from './useSkillHubModal'
import type { HubSkillItem, SkillDefinition, SkillSaveInput } from '../types'

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
    listSkillUninstallRecoveries: async () => [],
    listHubSources: vi.fn(),
    listHubSkillsAcrossSources: vi.fn(),
    listHubSkillsBySource: vi.fn(),
    installSkillFromHub: vi.fn(),
    uninstallSkill: vi.fn(),
    saveCustomSkill: vi.fn(),
    resetSkillToOriginal: vi.fn(),
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
        <p id="error">{state.loadError}</p>
      </div>
    )
  }
  const text = (id: string) => container.querySelector(`#${id}`)!.textContent
  const render = (open: boolean, workspace: string | null) => act(async () => root.render(<Harness open={open} workspace={workspace} />))
  const begin = async (action: () => Promise<void>) => {
    let pending!: Promise<void>
    await act(async () => {
      pending = action()
    })
    return { pending }
  }
  const saveInput: SkillSaveInput = { name: 'fixture', description: 'fixture', triggers: [], tags: [], content: 'fixture' }
  const mutations = [
    { name: 'uninstall', mock: api.uninstallSkill, run: () => state.handleDeleteSkill('fixture') },
    { name: 'save', mock: api.saveCustomSkill, run: () => state.handleSaveCustomSkill(saveInput) },
    { name: 'reset', mock: api.resetSkillToOriginal, run: () => state.handleResetSkill('fixture') },
  ]

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.resetAllMocks()
    api.listHubSources.mockResolvedValue([])
    Object.assign(window, { electronAPI: api })
  })

  it.each(mutations)('keeps $name on its origin workspace and drops its late UI result', async ({ mock, run }) => {
    const mutation = deferred<{ success: boolean }>()
    mock.mockReturnValue(mutation.promise)
    api.listInstalledSkills.mockImplementation(({ workspaceRoot }: { workspaceRoot?: string }) => Promise.resolve(installed(workspaceRoot || 'none')))
    api.listHubSkillsAcrossSources.mockResolvedValue([])
    await render(true, 'A')
    const started = await begin(run)
    expect(mock).toHaveBeenCalledWith(expect.objectContaining({ workspaceRoot: 'A' }))
    await render(true, 'B')
    const reads = api.listInstalledSkills.mock.calls.length
    await act(async () => mutation.resolve({ success: true }))
    await started.pending
    expect(text('installed')).toBe('B')
    expect(text('message')).toBe('')
    expect(text('loading')).toBe('false')
    expect(api.listInstalledSkills).toHaveBeenCalledTimes(reads)
  })

  it.each(mutations)('does not notify after closing during $name, and rereads effective state on reopening', async ({ mock, run }) => {
    let effective = 'before'
    const mutation = deferred<{ success: boolean }>()
    mock.mockReturnValue(mutation.promise)
    api.listInstalledSkills.mockImplementation(async () => installed(effective))
    api.listHubSkillsAcrossSources.mockResolvedValue([])
    await render(true, 'A')
    const started = await begin(run)
    await render(false, 'A')
    effective = 'after'
    const reads = api.listInstalledSkills.mock.calls.length
    await act(async () => mutation.resolve({ success: true }))
    await started.pending
    expect(text('message')).toBe('')
    expect(api.listInstalledSkills).toHaveBeenCalledTimes(reads)
    await render(true, 'A')
    expect(text('installed')).toBe('after')
    expect(text('message')).toBe('')
    expect(mock).toHaveBeenCalledTimes(1)
    expect(mock).toHaveBeenCalledWith(expect.objectContaining({ workspaceRoot: 'A' }))
  })

  it.each(mutations)('ignores a late $name failure while the new workspace is still loading', async ({ mock, run }) => {
    const mutation = deferred<{ success: boolean }>()
    const loadingB = deferred<SkillDefinition[]>()
    mock.mockReturnValue(mutation.promise)
    api.listInstalledSkills.mockImplementation(({ workspaceRoot }: { workspaceRoot?: string }) =>
      workspaceRoot === 'B' ? loadingB.promise : Promise.resolve(installed('A')),
    )
    api.listHubSkillsAcrossSources.mockResolvedValue([])
    await render(true, 'A')
    const started = await begin(run)
    await render(true, 'B')
    await act(async () => mutation.reject(new Error('A mutation failed late')))
    await started.pending
    expect(text('message')).toBe('')
    expect(text('loading')).toBe('true')
    await act(async () => loadingB.resolve(installed('B')))
    expect(text('installed')).toBe('B')
    expect(text('loading')).toBe('false')
  })

  it('does not switch the new workspace tab when a successful save finishes reloading the old one', async () => {
    api.saveCustomSkill.mockResolvedValue({ success: true })
    api.listInstalledSkills.mockResolvedValue(installed('initial'))
    api.listHubSkillsAcrossSources.mockResolvedValue([])
    await render(true, 'A')
    const refreshA = deferred<SkillDefinition[]>()
    api.listInstalledSkills.mockReturnValueOnce(refreshA.promise)
    const started = await begin(() => state.handleSaveCustomSkill(saveInput))
    await render(true, 'B')
    await act(async () => state.handleTabChange('hub'))
    expect(state.activeTab).toBe('hub')
    await act(async () => refreshA.resolve(installed('old A')))
    await started.pending
    expect(state.activeTab).toBe('hub')
    expect(text('installed')).toBe('initial')
    expect(text('message')).toBe('')
  })

  it.each(['hub', 'installed'] as const)('invalidates the earlier %s tab read, including its loading and failure', async (tab) => {
    api.listInstalledSkills.mockResolvedValue(installed('initial'))
    api.listHubSkillsAcrossSources.mockResolvedValue(hub('initial'))
    await render(true, 'A')
    const stale = deferred<Array<SkillDefinition | HubSkillItem>>()
    const latest = deferred<Array<SkillDefinition | HubSkillItem>>()
    const read = tab === 'hub' ? api.listHubSkillsAcrossSources : api.listInstalledSkills
    read.mockReturnValueOnce(stale.promise).mockReturnValueOnce(latest.promise)
    const first = await begin(() => state.handleTabChange(tab))
    await act(async () => state.handleTabChange(tab === 'hub' ? 'installed' : 'hub'))
    const second = await begin(() => state.handleTabChange(tab))
    expect(text('loading')).toBe('true')
    await act(async () => stale.reject(new Error('outdated tab failure')))
    await first.pending
    expect(text('loading')).toBe('true')
    expect(text('error')).toBe('')
    await act(async () => latest.resolve(tab === 'hub' ? hub('current') : installed('current')))
    await second.pending
    expect(text(tab)).toBe('current')
    expect(text('loading')).toBe('false')
  })

  it('discards an old tab success that finishes after the current tab read', async () => {
    api.listInstalledSkills.mockResolvedValue(installed('initial'))
    api.listHubSkillsAcrossSources.mockResolvedValue(hub('initial'))
    await render(true, 'A')
    const stale = deferred<HubSkillItem[]>()
    api.listHubSkillsAcrossSources.mockReturnValueOnce(stale.promise)
    const first = await begin(() => state.handleTabChange('hub'))
    await act(async () => state.handleTabChange('installed'))
    expect(text('loading')).toBe('false')
    await act(async () => stale.resolve(hub('stale')))
    await first.pending
    expect(text('hub')).toBe('initial')
    expect(text('installed')).toBe('initial')
    expect(text('loading')).toBe('false')
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
