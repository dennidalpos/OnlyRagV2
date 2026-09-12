import { describe, expect, it, vi } from 'vitest'
import { OllamaGenerationCancelledError, OllamaGenerationScheduler } from './ollamaGenerationScheduler'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('OllamaGenerationScheduler', () => {
  it('serializes structured and agent paths', async () => {
    const scheduler = new OllamaGenerationScheduler()
    const gate = deferred<string>()
    const order: string[] = []
    const structured = scheduler.schedule('structured', async () => {
      order.push('structured:start')
      const value = await gate.promise
      order.push('structured:end')
      return value
    })
    const agent = scheduler.schedule('agent', async () => {
      order.push('agent:start')
      return 'agent'
    })

    await Promise.resolve()
    expect(order).toEqual(['structured:start'])
    gate.resolve('structured')
    await expect(structured.promise).resolves.toBe('structured')
    await expect(agent.promise).resolves.toBe('agent')
    expect(order).toEqual(['structured:start', 'structured:end', 'agent:start'])
  })

  it('cancels a queued request without touching the active request', async () => {
    const scheduler = new OllamaGenerationScheduler()
    const gate = deferred<string>()
    const activeCancel = vi.fn()
    const active = scheduler.schedule('active', async (setCancel) => {
      setCancel(activeCancel)
      return gate.promise
    })
    const queuedRun = vi.fn(async () => 'queued')
    const queued = scheduler.schedule('queued', queuedRun)

    queued.cancel()
    await expect(queued.promise).rejects.toBeInstanceOf(OllamaGenerationCancelledError)
    expect(activeCancel).not.toHaveBeenCalled()
    expect(queuedRun).not.toHaveBeenCalled()
    gate.resolve('active')
    await expect(active.promise).resolves.toBe('active')
  })

  it('reports queue identities and cancels only the selected operation', async () => {
    const scheduler = new OllamaGenerationScheduler()
    const gate = deferred<string>()
    const first = scheduler.schedule('stream', async () => gate.promise, 'stream-1')
    const second = scheduler.schedule('stream', async () => 'second', 'stream-2')

    await Promise.resolve()
    expect(scheduler.getStatus()).toEqual({
      active: { id: 'stream-1', label: 'stream' },
      queued: [{ id: 'stream-2', label: 'stream' }],
    })
    expect(scheduler.cancel('stream-2')).toBe(true)
    await expect(second.promise).rejects.toBeInstanceOf(OllamaGenerationCancelledError)
    expect(scheduler.cancel('missing')).toBe(false)
    gate.resolve('first')
    await expect(first.promise).resolves.toBe('first')
  })
})
