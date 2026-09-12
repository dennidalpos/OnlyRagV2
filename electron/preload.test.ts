import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IElectronAPI } from '../shared/types'

const electronMock = vi.hoisted(() => ({
  api: null as IElectronAPI | null,
  invoke: vi.fn(),
  listeners: new Map<string, Set<(...args: any[]) => void>>(),
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn((_name: string, api: IElectronAPI) => {
      electronMock.api = api
    }),
  },
  ipcRenderer: {
    invoke: electronMock.invoke,
    on: vi.fn((channel: string, listener: (...args: any[]) => void) => {
      const listeners = electronMock.listeners.get(channel) || new Set()
      listeners.add(listener)
      electronMock.listeners.set(channel, listeners)
    }),
    removeListener: vi.fn((channel: string, listener: (...args: any[]) => void) => {
      electronMock.listeners.get(channel)?.delete(listener)
    }),
  },
}))

import './preload'

function emit(channel: string, payload: unknown) {
  electronMock.listeners.get(channel)?.forEach((listener) => listener({}, payload))
}

describe('preload Ollama stream isolation', () => {
  beforeEach(() => {
    electronMock.invoke.mockReset()
    electronMock.listeners.clear()
  })

  it('delivers only events matching each concurrent operation', async () => {
    const pending: ((result: { success: boolean }) => void)[] = []
    electronMock.invoke.mockImplementation((channel: string) => {
      if (channel !== 'ollama:generate-stream') return Promise.resolve()
      return new Promise<{ success: boolean }>((resolve) => pending.push(resolve))
    })
    const firstChunks: string[] = []
    const secondChunks: string[] = []
    const firstDone = vi.fn()
    const secondDone = vi.fn()

    const first = electronMock.api!.generateOllamaStream('model', 'one', (chunk) => firstChunks.push(chunk), {}, undefined, 'stream-1', firstDone)
    const second = electronMock.api!.generateOllamaStream('model', 'two', (chunk) => secondChunks.push(chunk), {}, undefined, 'stream-2', secondDone)

    emit('ollama:chunk', { operationId: 'stream-2', chunk: 'two' })
    emit('ollama:chunk', { operationId: 'stream-1', chunk: 'one' })
    emit('ollama:done', { operationId: 'stream-2' })
    emit('ollama:done', { operationId: 'stream-1' })
    pending.forEach((resolve) => resolve({ success: true }))
    await Promise.all([first, second])

    expect(firstChunks).toEqual(['one'])
    expect(secondChunks).toEqual(['two'])
    expect(firstDone).toHaveBeenCalledOnce()
    expect(secondDone).toHaveBeenCalledOnce()
    expect(electronMock.listeners.get('ollama:chunk')?.size || 0).toBe(0)
    expect(electronMock.listeners.get('ollama:done')?.size || 0).toBe(0)
  })

  it('returns Main stream failures without converting them to success', async () => {
    electronMock.invoke.mockResolvedValue({ success: false, error: 'connection lost' })

    await expect(electronMock.api!.generateOllamaStream('model', 'prompt', () => {}, {}, undefined, 'stream-failed')).resolves.toEqual({
      success: false,
      error: 'connection lost',
    })
  })
})
