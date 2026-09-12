import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: any[]) => any>()

vi.mock('electron', async (importOriginal) => ({
  ...(await importOriginal<typeof import('electron')>()),
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler)
    }),
  },
}))

vi.mock('../application/ollamaAppService', () => ({
  ollamaAppService: {
    installOrLaunchOllama: vi.fn(),
    pullModel: vi.fn(),
    cancelPullModel: vi.fn(),
    deleteModel: vi.fn(),
    cancelStream: vi.fn(),
    getGenerationStatus: vi.fn(),
    generateStream: vi.fn(),
    benchmarkModel: vi.fn(),
    getModelMetrics: vi.fn(),
    getRunningModels: vi.fn(),
    unloadModel: vi.fn(),
    testConnection: vi.fn(),
    checkModelUpdates: vi.fn(),
  },
}))

import { ollamaAppService } from '../application/ollamaAppService'
import { registerOllamaIpcHandlers } from './ollamaIpc'

describe('ollama IPC stream facade', () => {
  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
    registerOllamaIpcHandlers()
  })

  it('binds chunk and done events to the requested operation ID', async () => {
    vi.mocked(ollamaAppService.generateStream).mockImplementation(async (_model, _prompt, onChunk, onDone) => {
      onChunk('hello')
      onDone()
      return { success: true }
    })
    const send = vi.fn()

    await handlers.get('ollama:generate-stream')?.({ sender: { send } }, 'model', 'prompt', {}, 'http://host:11434', 'stream-1')

    expect(send).toHaveBeenNthCalledWith(1, 'ollama:chunk', { operationId: 'stream-1', chunk: 'hello' })
    expect(send).toHaveBeenNthCalledWith(2, 'ollama:done', { operationId: 'stream-1' })
    expect(ollamaAppService.generateStream).toHaveBeenCalledWith(
      'model',
      'prompt',
      expect.any(Function),
      expect.any(Function),
      {},
      'http://host:11434',
      'stream-1',
    )
  })
})
