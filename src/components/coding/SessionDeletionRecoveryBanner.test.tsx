import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { IElectronAPI, SessionDeletionOutcome, SessionDeletionRecoveryPage, SessionDeletionRecoverySummary } from '../../../shared/ipc/ipcContract'
import { I18nProvider } from '../../i18n'
import { SessionDeletionRecoveryBanner } from './SessionDeletionRecoveryBanner'

const operation: SessionDeletionRecoverySummary = {
  operationId: 'deletion-1',
  sessionIds: ['session-1', 'session-2'],
  workspacePath: 'C:/project',
  status: 'pending',
}
const list = vi.fn<IElectronAPI['listSessionDeletionRecovery']>()
const recover = vi.fn<IElectronAPI['actOnSessionDeletionRecovery']>()
const chooseDirectory = vi.fn<IElectronAPI['openDirectoryDialog']>()
const onResolved = vi.fn()
let root: Root
let container: HTMLDivElement
let previousApi: PropertyDescriptor | undefined

beforeEach(() => {
  list.mockReset().mockResolvedValue({ operations: [operation], total: 1 })
  recover.mockReset().mockResolvedValue({ status: 'complete' })
  chooseDirectory.mockReset().mockResolvedValue('C:/export')
  onResolved.mockReset()
  previousApi = Object.getOwnPropertyDescriptor(window, 'electronAPI')
  const api: Partial<IElectronAPI> = { listSessionDeletionRecovery: list, actOnSessionDeletionRecovery: recover, openDirectoryDialog: chooseDirectory }
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
        <SessionDeletionRecoveryBanner storageFailed={storageFailed} onResolved={onResolved} />
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
  expect(button('Retry deletion').disabled).toBe(false)
  expect(button('Restore session').disabled).toBe(false)
  expect(button('Export recovery').disabled).toBe(false)
}

it('stays hidden when no recovery operations exist', async () => {
  list.mockResolvedValue({ operations: [], total: 0 })
  await render()
  expect(container.querySelector('[role="alert"]')).toBeNull()
  expect(list).toHaveBeenCalledExactlyOnceWith({ offset: 0 })
  expect(onResolved).not.toHaveBeenCalled()
})

it.each([
  ['pending', 'Session deletion needs recovery.', true, true],
  ['restoring', 'Session deletion needs recovery.', false, true],
  ['complete', 'Deleted session backup retained.', false, true],
  ['incomplete', 'Session deletion preparation was interrupted.', false, false],
] as const)('offers only permitted actions for a %s operation', async (status, message, canRetry, canRestore) => {
  list.mockResolvedValue({ operations: [{ ...operation, status, workspacePath: status === 'incomplete' ? null : operation.workspacePath }], total: 1 })
  await render()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(message)
  expect(button('Retry deletion').disabled).toBe(!canRetry)
  expect(button('Restore session').disabled).toBe(!canRestore)
  expect(button('Export recovery').disabled).toBe(false)
  await act(async () => {
    for (const item of container.querySelectorAll('button')) if (item.disabled) item.click()
  })
  expect(recover).not.toHaveBeenCalled()
  expect(onResolved).not.toHaveBeenCalled()
})

it('exposes failed initial listing without claiming that sessions were resolved', async () => {
  list.mockRejectedValueOnce(new Error('Deletion journal unreadable'))
  await render()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Deletion journal unreadable')
  expect(container.querySelector('button')).toBeNull()
  expect(onResolved).not.toHaveBeenCalled()
})

it.each([
  ['Retry deletion', 'retry'],
  ['Restore session', 'restore'],
] as const)('acknowledges completed %s with the exact affected sessions', async (label, action) => {
  await render()
  list.mockResolvedValueOnce(action === 'restore' ? { operations: [], total: 0 } : { operations: [{ ...operation, status: 'complete' }], total: 1 })
  await click(label)
  expect(recover).toHaveBeenCalledExactlyOnceWith({ operationId: operation.operationId, action, destinationDirectory: undefined })
  expect(onResolved).toHaveBeenCalledExactlyOnceWith(operation.sessionIds)
  expect(list).toHaveBeenNthCalledWith(2, { offset: 0 })
  expect(chooseDirectory).not.toHaveBeenCalled()
  if (action === 'restore') expect(container.querySelector('[role="alert"]')).toBeNull()
  else {
    expect(button('Retry deletion').disabled).toBe(true)
    expect(button('Restore session').disabled).toBe(false)
    expect(button('Export recovery').disabled).toBe(false)
  }
})

it.each([
  { status: 'refused', error: 'Active agent owns this session', expected: 'Active agent owns this session' },
  { status: 'refused', error: undefined, expected: 'Recovery remains pending' },
  { status: 'pending', error: 'Restore fence unavailable', expected: 'Restore fence unavailable' },
  { status: 'pending', error: undefined, expected: 'Recovery remains pending' },
] satisfies (SessionDeletionOutcome & { expected: string })[])(
  'preserves recovery actions for $status with error $error',
  async ({ status, error, expected }) => {
    recover.mockResolvedValueOnce({ status, error })
    await render()
    await click('Restore session')
    expect(container.textContent).toContain(expected)
    expect(container.textContent).not.toContain('Recovery copy saved')
    expect(onResolved).not.toHaveBeenCalled()
    expectAvailable()
  },
)

it.each(['Retry deletion', 'Restore session', 'Export recovery'])('reports an IPC failure from %s without discarding the operation', async (label) => {
  recover.mockRejectedValueOnce(new Error('Recovery filesystem unavailable'))
  await render()
  await click(label)
  expect(container.textContent).toContain('Recovery filesystem unavailable')
  expect(container.textContent).toContain('C:/project')
  expect(container.textContent).not.toContain('Recovery copy saved')
  expect(onResolved).not.toHaveBeenCalled()
  expectAvailable()
})

it('cancels export before invoking Main and restores the controls', async () => {
  chooseDirectory.mockResolvedValueOnce(null)
  await render()
  await click('Export recovery')
  expect(chooseDirectory).toHaveBeenCalledExactlyOnceWith({ title: 'Choose a folder for the recovery copy' })
  expect(recover).not.toHaveBeenCalled()
  expect(list).toHaveBeenCalledOnce()
  expect(container.textContent).not.toContain('Recovery copy saved')
  expect(onResolved).not.toHaveBeenCalled()
  expectAvailable()
})

it('exports a retained copy while leaving the pending operation unresolved', async () => {
  recover.mockResolvedValueOnce({ status: 'pending', exportPath: 'C:/export/deletion.json' })
  await render()
  await click('Export recovery')
  expect(recover).toHaveBeenCalledExactlyOnceWith({ operationId: operation.operationId, action: 'export', destinationDirectory: 'C:/export' })
  expect(container.textContent).toContain('Recovery copy saved to C:/export/deletion.json')
  expect(container.textContent).not.toContain('Recovery action failed')
  expect(onResolved).not.toHaveBeenCalled()
  expect(list).toHaveBeenCalledTimes(2)
  expectAvailable()
})

it('keeps Export available for an incomplete preparation and never retries or restores it', async () => {
  list.mockResolvedValue({ operations: [{ ...operation, status: 'incomplete', sessionIds: [], workspacePath: null }], total: 1 })
  recover.mockResolvedValueOnce({ status: 'pending', exportPath: 'C:/export/staging.json' })
  await render()
  await click('Export recovery')
  expect(recover).toHaveBeenCalledExactlyOnceWith({ operationId: operation.operationId, action: 'export', destinationDirectory: 'C:/export' })
  expect(container.textContent).toContain('C:/export/staging.json')
  expect(button('Retry deletion').disabled).toBe(true)
  expect(button('Restore session').disabled).toBe(true)
  expect(button('Export recovery').disabled).toBe(false)
  expect(onResolved).not.toHaveBeenCalled()
})

it('reports a refused export without a success message', async () => {
  recover.mockResolvedValueOnce({ status: 'refused', error: 'Destination is not writable' })
  await render()
  await click('Export recovery')
  expect(container.textContent).toContain('Destination is not writable')
  expect(container.textContent).not.toContain('Recovery copy saved')
  expect(onResolved).not.toHaveBeenCalled()
  expectAvailable()
})

it('handles a failed folder dialog before invoking recovery', async () => {
  chooseDirectory.mockRejectedValueOnce(new Error('Dialog unavailable'))
  await render()
  await click('Export recovery')
  expect(container.textContent).toContain('Dialog unavailable')
  expect(recover).not.toHaveBeenCalled()
  expect(onResolved).not.toHaveBeenCalled()
  expectAvailable()
})

it('blocks recovery and pagination while Main is processing an action', async () => {
  list.mockResolvedValue({ operations: [operation], total: 2 })
  let finish!: (result: SessionDeletionOutcome) => void
  recover.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await render()
  await click('Retry deletion')
  expect([...container.querySelectorAll('button')].every((item) => item.disabled)).toBe(true)
  await click('Show more recovery operations')
  await click('Restore session')
  expect(recover).toHaveBeenCalledOnce()
  expect(list).toHaveBeenCalledOnce()
  await act(async () => finish({ status: 'pending', error: 'Retry not complete' }))
  expect(container.textContent).toContain('Retry not complete')
  expect([...container.querySelectorAll('button')].every((item) => !item.disabled)).toBe(true)
  expect(onResolved).not.toHaveBeenCalled()
})

it('keeps actions busy while choosing the export directory', async () => {
  let finish!: (destination: string | null) => void
  chooseDirectory.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await render()
  await click('Export recovery')
  expect([...container.querySelectorAll('button')].every((item) => item.disabled)).toBe(true)
  await act(async () => finish(null))
  expect(recover).not.toHaveBeenCalled()
  expectAvailable()
})

it('reports a failed refresh after acknowledged recovery and releases the controls', async () => {
  await render()
  list.mockRejectedValueOnce(new Error('Refresh unavailable'))
  await click('Restore session')
  expect(onResolved).toHaveBeenCalledExactlyOnceWith(operation.sessionIds)
  expect(container.textContent).toContain('Refresh unavailable')
  expectAvailable()
})

it('appends the next recovery page using the retained operation count', async () => {
  list
    .mockResolvedValueOnce({ operations: [operation], total: 2 })
    .mockResolvedValueOnce({ operations: [{ ...operation, operationId: 'deletion-2', workspacePath: 'C:/other' }], total: 2 })
  await render()
  await click('Show more recovery operations')
  expect(list).toHaveBeenNthCalledWith(2, { offset: 1 })
  expect(container.textContent).toContain('C:/project')
  expect(container.textContent).toContain('C:/other')
  expect(container.querySelectorAll('button')).toHaveLength(6)
  expect(container.textContent).not.toContain('Show more recovery operations')
  expect(onResolved).not.toHaveBeenCalled()
})

it('preserves loaded operations and permits another pagination attempt after failure', async () => {
  list.mockResolvedValueOnce({ operations: [operation], total: 2 }).mockRejectedValueOnce(new Error('Next page unavailable'))
  await render()
  await click('Show more recovery operations')
  expect(container.textContent).toContain('Next page unavailable')
  expect(container.textContent).toContain('C:/project')
  expect(button('Show more recovery operations').disabled).toBe(false)
  expect(onResolved).not.toHaveBeenCalled()
  expectAvailable()
})

it('ignores a stale listing after storageFailed triggers another load', async () => {
  let finish!: (page: SessionDeletionRecoveryPage) => void
  list.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await render()
  await render(true)
  await act(async () => finish({ operations: [{ ...operation, workspacePath: 'C:/obsolete' }], total: 1 }))
  expect(list).toHaveBeenCalledTimes(2)
  expect(container.textContent).toContain('C:/project')
  expect(container.textContent).not.toContain('C:/obsolete')
})

it('ignores a failed obsolete load after the current load succeeds', async () => {
  let fail!: (error: Error) => void
  list.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      fail = reject
    }),
  )
  await render()
  await render(true)
  await act(async () => fail(new Error('Obsolete failure')))
  expect(container.textContent).toContain('C:/project')
  expect(container.textContent).not.toContain('Obsolete failure')
  expectAvailable()
})
