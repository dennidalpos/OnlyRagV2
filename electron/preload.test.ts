import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { IPC_EVENT_METHODS, IPC_INVOKE_METHODS, type IElectronAPI, type UnmappedIpcChannels } from '../shared/ipc/ipcContract'

const electronMock = vi.hoisted(() => ({
  api: null as IElectronAPI | null,
  invoke: vi.fn(),
  listeners: new Map<string, Set<(...args: unknown[]) => void>>(),
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn((_name: string, api: IElectronAPI) => {
      electronMock.api = api
    }),
  },
  ipcRenderer: {
    invoke: electronMock.invoke,
    on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
      const listeners = electronMock.listeners.get(channel) || new Set()
      listeners.add(listener)
      electronMock.listeners.set(channel, listeners)
    }),
    removeListener: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
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

    const first = electronMock.api!.generateOllamaStream(
      { model: 'model', prompt: 'one', operationId: 'stream-1' },
      (chunk) => firstChunks.push(chunk),
      firstDone,
    )
    const second = electronMock.api!.generateOllamaStream(
      { model: 'model', prompt: 'two', operationId: 'stream-2' },
      (chunk) => secondChunks.push(chunk),
      secondDone,
    )

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

    await expect(electronMock.api!.generateOllamaStream({ model: 'model', prompt: 'prompt', operationId: 'stream-failed' }, () => {})).resolves.toEqual({
      success: false,
      error: 'connection lost',
    })
  })

  it('forwards backend context budgets and context-compaction requests', async () => {
    const callback = vi.fn()
    const unsubscribe = electronMock.api!.onAgentContextBudget!(callback)
    const payload = { runId: 'run-1', promptTokens: 1200, promptBudgetTokens: 4000 }
    emit('agent:context-budget', payload)

    expect(callback).toHaveBeenCalledWith(payload)
    await electronMock.api!.compactAgentContext!({
      runId: 'run-1',
      conversationId: 'conversation-1',
      planRevisionId: 'plan-1',
      workspaceId: 'workspace-1',
    })
    expect(electronMock.invoke).toHaveBeenCalledWith('agent:compact-context', expect.objectContaining({ runId: 'run-1' }))

    unsubscribe()
    expect(electronMock.listeners.get('agent:context-budget')?.size || 0).toBe(0)
  })

  it('exposes explicit Coding Agent audit-log cleanup', async () => {
    electronMock.invoke.mockResolvedValue(true)
    await expect(electronMock.api!.clearCodingAgentAuditLog!()).resolves.toBe(true)
    expect(electronMock.invoke).toHaveBeenCalledWith('diagnostics:clear-agent-audit-log')
  })

  it('sends one object payload per invoke and names the stream operation it generates', async () => {
    electronMock.invoke.mockResolvedValue({ success: true })
    await electronMock.api!.ingestFile({ filePath: 'C:/docs/a.pdf', numCtx: 8192, taskId: 'task-1' })
    expect(electronMock.invoke).toHaveBeenLastCalledWith('ingest:file', { filePath: 'C:/docs/a.pdf', numCtx: 8192, taskId: 'task-1' })

    await electronMock.api!.generateOllamaStream({ model: 'model', prompt: 'prompt' }, () => {})
    expect(electronMock.invoke).toHaveBeenLastCalledWith('ollama:generate-stream', {
      model: 'model',
      prompt: 'prompt',
      operationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    })
  })

  it('exposes every contract method', () => {
    // Checked by the compiler: a channel declared in the contract without a method fails the typecheck.
    expectTypeOf<UnmappedIpcChannels['invoke']>().toEqualTypeOf<never>()
    expectTypeOf<UnmappedIpcChannels['event']>().toEqualTypeOf<never>()
    for (const method of [...Object.keys(IPC_INVOKE_METHODS), ...Object.keys(IPC_EVENT_METHODS), 'generateOllamaStream', 'respondAgentSkillInstall']) {
      expect(typeof electronMock.api![method as keyof IElectronAPI], method).toBe('function')
    }
  })
})
