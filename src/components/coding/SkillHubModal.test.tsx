import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SkillHubModal } from './SkillHubModal'
import { I18nProvider } from '../../i18n'

describe('SkillHubModal source loading recovery', () => {
  let root: Root
  let container: HTMLDivElement
  const previous = window.electronAPI
  const api = {
    listInstalledSkills: vi.fn(),
    listSkillUninstallRecoveries: async () => [],
    listHubSources: vi.fn(),
    listHubSkillsAcrossSources: vi.fn(),
    addCustomHubSource: vi.fn(),
    removeCustomHubSource: vi.fn(),
  }
  const render = (workspacePath = 'A', isOpen = true) =>
    act(async () =>
      root.render(
        <I18nProvider initialLanguage="it">
          <SkillHubModal isOpen={isOpen} onClose={() => {}} workspacePath={workspacePath} />
        </I18nProvider>,
      ),
    )
  const alert = () => document.querySelector('[role="alert"]')
  const retry = () => alert()!.querySelector('button')!

  beforeEach(() => {
    vi.resetAllMocks()
    api.listInstalledSkills.mockResolvedValue([])
    api.listHubSkillsAcrossSources.mockResolvedValue([])
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    window.electronAPI = api as unknown as typeof window.electronAPI
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    window.electronAPI = previous
  })

  it('shows a source error instead of an empty list, and reloads sources without reopening or mutating them', async () => {
    let reject!: (error: Error) => void
    api.listHubSources
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, fail) => {
            reject = fail
          }),
      )
      .mockResolvedValue([{ id: 'fixture', name: 'Recovered source', url: 'http://127.0.0.1/hub', type: 'json-catalog' }])
    await render()
    const pendingTab = document.querySelector<HTMLButtonElement>('#skill-tab-hub')!
    expect(pendingTab.disabled).toBe(true)
    await act(async () => pendingTab.click())
    expect(api.listHubSkillsAcrossSources).not.toHaveBeenCalled()
    await act(async () => reject(new Error('custom_hubs.json is not valid JSON')))
    expect(alert()?.textContent).toContain('custom_hubs.json is not valid JSON')
    expect(document.querySelector('[role="tabpanel"]')).toBeNull()
    expect(retry().textContent).toBe('Riprova')
    expect(api.listHubSkillsAcrossSources).not.toHaveBeenCalled()
    await act(async () => retry().click())
    expect(alert()).toBeNull()
    expect(api.listHubSources).toHaveBeenCalledTimes(2)
    const hubTab = document.querySelector<HTMLButtonElement>('#skill-tab-hub')!
    await act(async () => hubTab.click())
    expect(document.querySelector('#skill-panel-hub')).not.toBeNull()
    expect(api.listHubSkillsAcrossSources).toHaveBeenCalledWith({ workspaceRoot: 'A' })
    expect(api.addCustomHubSource).not.toHaveBeenCalled()
    expect(api.removeCustomHubSource).not.toHaveBeenCalled()
  })

  it('disables duplicate retries, keeps a repeated error visible, and recovers on a later retry', async () => {
    let reject!: (error: Error) => void
    api.listHubSources
      .mockRejectedValueOnce(new Error('invalid source'))
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, fail) => {
            reject = fail
          }),
      )
      .mockResolvedValue([])
    await render()
    await act(async () => retry().click())
    expect(retry().disabled).toBe(true)
    await act(async () => retry().click())
    expect(api.listHubSources).toHaveBeenCalledTimes(2)
    await act(async () => reject(new Error('source still unreadable')))
    expect(alert()?.textContent).toContain('source still unreadable')
    expect(retry().disabled).toBe(false)
    await act(async () => retry().click())
    expect(alert()).toBeNull()
  })

  it('allows switching away from a slow marketplace tab without showing its late error', async () => {
    let reject!: (error: Error) => void
    api.listHubSources.mockResolvedValue([])
    await render()
    api.listHubSkillsAcrossSources.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail
        }),
    )
    const hubTab = document.querySelector<HTMLButtonElement>('#skill-tab-hub')!
    const installedTab = document.querySelector<HTMLButtonElement>('#skill-tab-installed')!
    await act(async () => hubTab.click())
    expect(installedTab.disabled).toBe(false)
    await act(async () => installedTab.click())
    await act(async () => reject(new Error('late marketplace failure')))
    expect(installedTab.getAttribute('aria-selected')).toBe('true')
    expect(alert()).toBeNull()
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it.each(['workspace', 'close'] as const)('ignores a retry failure after changing %s', async (change) => {
    let reject!: (error: Error) => void
    api.listHubSources
      .mockRejectedValueOnce(new Error('initial failure'))
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, fail) => {
            reject = fail
          }),
      )
      .mockResolvedValue([])
    await render()
    await act(async () => retry().click())
    await render('B', change !== 'close')
    await act(async () => reject(new Error('stale failure')))
    if (change === 'close') await render('B')
    expect(alert()).toBeNull()
    expect(document.querySelector('[role="tabpanel"]')).not.toBeNull()
  })
})
