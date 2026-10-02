import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppLayout } from './AppLayout'
import { I18nProvider } from '../../i18n'
import { DEFAULT_APP_SETTINGS } from '../../../shared/domain/settings/appSettingsDefaults'
import type { AppSettings } from '../../types'

vi.mock('../../hooks/useDiagnostics', () => ({
  useDiagnostics: () => ({ diagnostics: null, refreshDiagnostics: vi.fn() }),
}))
vi.mock('../../hooks/useModelDownloadProgress', () => ({
  useModelDownloadProgress: () => ({ isDownloading: false, lastCompletedModel: null }),
}))
vi.mock('../ingestion/IngestionView', () => ({
  IngestionView: ({ settings, onUpdateSettings }: { settings: AppSettings; onUpdateSettings: (value: Partial<AppSettings>) => void }) => (
    <button type="button" data-testid="edit" onClick={() => onUpdateSettings({ chatModel: `${settings.chatModel}x` })}>
      {settings.chatModel}
    </button>
  ),
}))

describe('settings save feedback', () => {
  let root: Root
  let container: HTMLDivElement
  let save: ReturnType<typeof vi.fn<(settings: AppSettings) => Promise<boolean>>>
  let load: ReturnType<typeof vi.fn<() => Promise<AppSettings | null>>>
  const initial = { ...DEFAULT_APP_SETTINGS, defaultModel: 'installed', chatModel: 'original', hasCompletedInitialSetup: true, language: 'en' as const }

  async function mount() {
    await act(async () =>
      root.render(
        <I18nProvider initialLanguage="en">
          <AppLayout />
        </I18nProvider>,
      ),
    )
  }
  async function tick() {
    await act(async () => vi.advanceTimersByTime(100))
  }
  async function click(selector: string) {
    const button = container.querySelector<HTMLButtonElement>(selector)
    expect(button).not.toBeNull()
    await act(async () => button!.click())
  }

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    container = document.createElement('div')
    root = createRoot(container)
    save = vi.fn(async () => true)
    load = vi.fn(async () => initial)
    vi.stubGlobal('electronAPI', { getAppSettings: load, saveAppSettings: save })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    localStorage.clear()
  })

  it('shows a rejected save and retries the current in-memory values', async () => {
    await mount()
    await tick()
    save.mockResolvedValueOnce(false)
    await click('[data-testid="edit"]')
    await tick()
    expect(container.querySelector('[role="alert"]')?.textContent ?? '').toContain('not saved')
    expect(container.querySelector('[data-testid="edit"]')?.textContent).toBe('originalx')
    await click('[data-testid="settings-save-retry"]')
    await tick()
    expect(save.mock.calls.at(-1)?.[0].chatModel).toBe('originalx')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelector('[data-testid="settings-save-status"]')?.textContent).toContain('saved')
  })

  it('shows thrown failures and keeps the retry warning after another failed save', async () => {
    save.mockRejectedValueOnce(new Error('disk unavailable')).mockResolvedValueOnce(false)
    await mount()
    await tick()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('not saved')
    await click('[data-testid="settings-save-retry"]')
    await tick()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('not saved')
    expect(container.querySelector('[data-testid="settings-save-status"]')?.textContent).not.toBe('Settings saved.')
  })

  it('serializes writes and does not announce older completion as the latest save', async () => {
    let finishFirst!: (value: boolean) => void
    let finishSecond!: (value: boolean) => void
    save
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finishFirst = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finishSecond = resolve
          }),
      )
    await mount()
    await tick()
    await click('[data-testid="edit"]')
    await tick()
    expect(save).toHaveBeenCalledTimes(1)
    await act(async () => finishFirst(true))
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][0].chatModel).toBe('originalx')
    expect(container.querySelector('[data-testid="settings-save-status"]')?.textContent).toBe('Saving settings…')
    await act(async () => finishSecond(true))
    expect(container.querySelector('[data-testid="settings-save-status"]')?.textContent).toBe('Settings saved.')
  })

  it('skips superseded queued snapshots and recovers the queue after an older failure', async () => {
    let failFirst!: (error: Error) => void
    save.mockImplementationOnce(
      () =>
        new Promise<boolean>((_resolve, reject) => {
          failFirst = reject
        }),
    )
    await mount()
    await tick()
    await click('[data-testid="edit"]')
    await tick()
    await click('[data-testid="edit"]')
    await tick()
    await act(async () => failFirst(new Error('old save failed')))
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][0].chatModel).toBe('originalxx')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelector('[data-testid="settings-save-status"]')?.textContent).toBe('Settings saved.')
  })

  it('blocks writes after a bootstrap failure and saves only after a successful read retry', async () => {
    load.mockRejectedValueOnce(new Error('invalid settings file'))
    await mount()
    await tick()
    await click('[data-testid="edit"]')
    await tick()
    expect(save).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="settings-bootstrap-error"]')).not.toBeNull()
    await click('[data-testid="settings-bootstrap-error"] button')
    await tick()
    expect(save.mock.calls[0][0].chatModel).toBe('original')
    expect(container.querySelector('[data-testid="settings-bootstrap-error"]')).toBeNull()
  })

  it('reports an unavailable save bridge instead of claiming success', async () => {
    vi.stubGlobal('electronAPI', { getAppSettings: load })
    await mount()
    await tick()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('not saved')
    expect(save).not.toHaveBeenCalled()
  })

  it('cancels pending debounce writes when the layout is unmounted', async () => {
    await mount()
    await act(async () => root.unmount())
    await tick()
    expect(save).not.toHaveBeenCalled()
  })
})
