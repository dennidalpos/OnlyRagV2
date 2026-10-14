import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shell } from 'electron'
import { spawn } from 'node:child_process'

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))
vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
vi.mock('node:fs', () => ({ default: { existsSync: vi.fn(() => false) } }))
vi.mock('../logging/logger', () => ({ logger: { log: vi.fn() } }))

import { OllamaInstallerRepository } from './ollamaInstallerRepository'

const repository = new OllamaInstallerRepository()
const downloadPage = 'https://ollama.com/download/windows'

function mockProcess(event: 'spawn' | 'error') {
  const child = new EventEmitter() as EventEmitter & { unref: ReturnType<typeof vi.fn> }
  child.unref = vi.fn()
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
  queueMicrotask(() => child.emit(event, event === 'error' ? new Error('ENOENT') : undefined))
  return child
}

describe('OllamaInstallerRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(shell.openExternal).mockResolvedValue(undefined)
  })

  it('reports a local process launch only after the spawn event', async () => {
    const child = mockProcess('spawn')
    await expect(repository.installOrLaunch()).resolves.toEqual({ success: true, action: 'launched' })
    expect(child.unref).toHaveBeenCalledOnce()
    expect(shell.openExternal).not.toHaveBeenCalled()
  })

  it('opens only the official manual download page when the local launch fails', async () => {
    mockProcess('error')
    await expect(repository.installOrLaunch()).resolves.toEqual({ success: true, action: 'manual-download' })
    expect(shell.openExternal).toHaveBeenCalledExactlyOnceWith(downloadPage)
  })

  it('waits for the browser result and reports an opening failure', async () => {
    mockProcess('error')
    vi.mocked(shell.openExternal).mockRejectedValue(new Error('no browser'))
    await expect(repository.installOrLaunch()).resolves.toEqual({ success: false, error: 'Could not open Ollama download page: no browser' })
  })

  it('does not report manual handoff before the browser confirms opening', async () => {
    mockProcess('error')
    let finishOpening: (() => void) | undefined
    vi.mocked(shell.openExternal).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishOpening = resolve
        }),
    )
    const result = repository.installOrLaunch()
    let settled = false
    void result.then(() => {
      settled = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(settled).toBe(false)
    finishOpening?.()
    await expect(result).resolves.toEqual({ success: true, action: 'manual-download' })
  })
})
