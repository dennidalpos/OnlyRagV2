import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CodingHistoryRecoveryOutcome, CodingHistoryRecoverySummary, IElectronAPI } from '../../../shared/ipc/ipcContract'
import { I18nProvider } from '../../i18n'
import { CodingHistoryRecoveryBanner } from './CodingHistoryRecoveryBanner'

const record: CodingHistoryRecoverySummary = { recoveryId: 'recovery-1', sessionId: 'session-1', workspacePath: 'C:/project' }
const list = vi.fn<IElectronAPI['listCodingHistoryRecovery']>()
const recover = vi.fn<IElectronAPI['actOnCodingHistoryRecovery']>()
const chooseDirectory = vi.fn<IElectronAPI['openDirectoryDialog']>()
const onRecovered = vi.fn()
let root: Root
let container: HTMLDivElement
let previousApi: PropertyDescriptor | undefined

beforeEach(() => {
  list.mockReset().mockResolvedValue([record])
  recover.mockReset().mockResolvedValue({ status: 'complete' })
  chooseDirectory.mockReset().mockResolvedValue('C:/export')
  onRecovered.mockReset()
  previousApi = Object.getOwnPropertyDescriptor(window, 'electronAPI')
  const api: Partial<IElectronAPI> = { listCodingHistoryRecovery: list, actOnCodingHistoryRecovery: recover, openDirectoryDialog: chooseDirectory }
  Object.defineProperty(window, 'electronAPI', { configurable: true, writable: true, value: api })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  if (previousApi) Object.defineProperty(window, 'electronAPI', previousApi)
  else delete window.electronAPI
})

async function render(storageFailed = false) {
  await act(async () =>
    root.render(
      <I18nProvider initialLanguage="en">
        <CodingHistoryRecoveryBanner storageFailed={storageFailed} onRecovered={onRecovered} />
      </I18nProvider>,
    ),
  )
}

function button(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find((item) => item.textContent === label)
  if (!match) throw new Error(`Missing button: ${label}`)
  return match
}

async function click(label: string) {
  await act(async () => button(label).click())
}

function expectAvailable() {
  expect(button('Retry history').disabled).toBe(false)
  expect(button('Export snapshot').disabled).toBe(false)
}

it('stays hidden when no retained history needs recovery', async () => {
  list.mockResolvedValue([])
  await render()
  expect(container.querySelector('[role="alert"]')).toBeNull()
  expect(onRecovered).not.toHaveBeenCalled()
})

it('identifies every retained session including standalone workspaces', async () => {
  list.mockResolvedValue([record, { recoveryId: 'recovery-2', sessionId: 'session-2', workspacePath: null }])
  await render()
  expect(container.textContent).toContain('session-1 (C:/project)')
  expect(container.textContent).toContain('session-2 (No Project Attached (Standalone))')
  expect(container.querySelectorAll('button')).toHaveLength(4)
  expectAvailable()
})

it('exposes a failed initial listing without claiming recovery', async () => {
  list.mockRejectedValue(new Error('Journal is unreadable'))
  await render()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Journal is unreadable')
  expect(container.querySelector('button')).toBeNull()
  expect(onRecovered).not.toHaveBeenCalled()
})

it('acknowledges a completed retry and refreshes the retained list', async () => {
  await render()
  list.mockResolvedValueOnce([])
  await click('Retry history')
  expect(recover).toHaveBeenCalledExactlyOnceWith({ recoveryId: 'recovery-1', action: 'retry', destinationDirectory: undefined })
  expect(onRecovered).toHaveBeenCalledOnce()
  expect(list).toHaveBeenCalledTimes(2)
  expect(chooseDirectory).not.toHaveBeenCalled()
  expect(container.querySelector('[role="alert"]')).toBeNull()
})

it.each([
  ['Retry history', 'retry'],
  ['Export snapshot', 'export'],
] as const)('keeps recovery available when %s is refused', async (label, action) => {
  recover.mockResolvedValueOnce({ status: 'refused', error: 'Canonical history diverged' })
  await render()
  await click(label)
  expect(recover).toHaveBeenCalledWith({ recoveryId: record.recoveryId, action, destinationDirectory: action === 'export' ? 'C:/export' : undefined })
  expect(container.textContent).toContain('Canonical history diverged')
  expect(container.textContent).not.toContain('Recovery copy saved')
  expect(onRecovered).not.toHaveBeenCalled()
  expectAvailable()
})

it('provides the translated refusal when Main returns no error detail', async () => {
  recover.mockResolvedValueOnce({ status: 'refused' })
  await render()
  await click('Retry history')
  expect(container.textContent).toContain('History recovery was refused')
  expect(onRecovered).not.toHaveBeenCalled()
  expectAvailable()
})

it.each(['Retry history', 'Export snapshot'])('shows IPC failures from %s and permits another attempt', async (label) => {
  recover.mockRejectedValueOnce(new Error('Recovery storage unavailable'))
  await render()
  await click(label)
  expect(container.textContent).toContain('Recovery storage unavailable')
  expect(container.textContent).not.toContain('Recovery copy saved')
  expect(onRecovered).not.toHaveBeenCalled()
  expectAvailable()
})

it('cancels export before invoking the recovery action and restores both buttons', async () => {
  chooseDirectory.mockResolvedValueOnce(null)
  await render()
  await click('Export snapshot')
  expect(chooseDirectory).toHaveBeenCalledExactlyOnceWith({ title: 'Choose a folder for the coding history snapshot' })
  expect(recover).not.toHaveBeenCalled()
  expect(list).toHaveBeenCalledOnce()
  expect(container.textContent).not.toContain('Recovery copy saved')
  expect(onRecovered).not.toHaveBeenCalled()
  expectAvailable()
})

it('shows the exported path without treating export as canonical recovery', async () => {
  recover.mockResolvedValueOnce({ status: 'complete', exportPath: 'C:/export/retained.json' })
  await render()
  await click('Export snapshot')
  expect(recover).toHaveBeenCalledExactlyOnceWith({ recoveryId: record.recoveryId, action: 'export', destinationDirectory: 'C:/export' })
  expect(container.textContent).toContain('Recovery copy saved to C:/export/retained.json')
  expect(container.textContent).toContain(record.sessionId)
  expect(onRecovered).not.toHaveBeenCalled()
  expect(list).toHaveBeenCalledTimes(2)
  expectAvailable()
})

it('handles a failed folder dialog without invoking Main recovery', async () => {
  chooseDirectory.mockRejectedValueOnce(new Error('Dialog unavailable'))
  await render()
  await click('Export snapshot')
  expect(container.textContent).toContain('Dialog unavailable')
  expect(recover).not.toHaveBeenCalled()
  expect(onRecovered).not.toHaveBeenCalled()
  expectAvailable()
})

it('blocks every retained record while a recovery action is pending', async () => {
  list.mockResolvedValue([record, { ...record, recoveryId: 'recovery-2', sessionId: 'session-2' }])
  let finish!: (result: CodingHistoryRecoveryOutcome) => void
  recover.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await render()
  await click('Retry history')
  expect([...container.querySelectorAll('button')].every((item) => item.disabled)).toBe(true)
  await click('Export snapshot')
  expect(recover).toHaveBeenCalledOnce()
  expect(chooseDirectory).not.toHaveBeenCalled()
  await act(async () => finish({ status: 'refused', error: 'Retry refused' }))
  expect([...container.querySelectorAll('button')].every((item) => !item.disabled)).toBe(true)
  expect(container.textContent).toContain('Retry refused')
  expect(onRecovered).not.toHaveBeenCalled()
})

it('keeps the controls busy until the destination dialog settles', async () => {
  let finish!: (destination: string | null) => void
  chooseDirectory.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await render()
  await click('Export snapshot')
  expect([...container.querySelectorAll('button')].every((item) => item.disabled)).toBe(true)
  await act(async () => finish(null))
  expect(recover).not.toHaveBeenCalled()
  expectAvailable()
})

it('reports a refresh failure after an acknowledged retry without leaving the controls busy', async () => {
  await render()
  list.mockRejectedValueOnce(new Error('Refresh unavailable'))
  await click('Retry history')
  expect(onRecovered).toHaveBeenCalledOnce()
  expect(container.textContent).toContain('Refresh unavailable')
  expectAvailable()
})

it('ignores a stale listing when storageFailed triggers a new load', async () => {
  let finish!: (records: CodingHistoryRecoverySummary[]) => void
  list.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await render()
  await render(true)
  await act(async () => finish([{ ...record, sessionId: 'obsolete-session' }]))
  expect(list).toHaveBeenCalledTimes(2)
  expect(container.textContent).toContain(record.sessionId)
  expect(container.textContent).not.toContain('obsolete-session')
})

it('ignores a failed obsolete load after a new load succeeds', async () => {
  let fail!: (error: Error) => void
  list.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      fail = reject
    }),
  )
  await render()
  await render(true)
  await act(async () => fail(new Error('Obsolete failure')))
  expect(container.textContent).toContain(record.sessionId)
  expect(container.textContent).not.toContain('Obsolete failure')
  expectAvailable()
})
