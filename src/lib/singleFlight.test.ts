import { describe, it, expect, vi } from 'vitest'
import { createSingleFlight } from './singleFlight'

/** A promise whose settlement the test controls. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createSingleFlight', () => {
  it('runs the operation once for callers that arrive while it is in flight', async () => {
    const gate = deferred<string>()
    const operation = vi.fn(() => gate.promise)
    const call = createSingleFlight(operation)

    const results = [call(), call(), call(), call()]
    gate.resolve('documents')

    expect(await Promise.all(results)).toEqual(['documents', 'documents', 'documents', 'documents'])
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('hands every concurrent caller the identical promise', () => {
    const gate = deferred<number>()
    const call = createSingleFlight(() => gate.promise)

    const first = call()
    const second = call()

    expect(first).toBe(second)
    gate.resolve(1)
  })

  it('starts a fresh call once the previous one has settled — it is not a cache', async () => {
    const operation = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second')
    const call = createSingleFlight(operation)

    expect(await call()).toBe('first')
    expect(await call()).toBe('second')
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('releases the slot after a rejection instead of wedging later callers', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('sidecar unreachable'))
      .mockResolvedValueOnce('recovered')
    const call = createSingleFlight(operation)

    await expect(call()).rejects.toThrow('sidecar unreachable')
    expect(await call()).toBe('recovered')
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('propagates one rejection to every caller that joined the same flight', async () => {
    const gate = deferred<string>()
    const call = createSingleFlight(() => gate.promise)

    const first = call()
    const second = call()
    gate.reject(new Error('boom'))

    await expect(first).rejects.toThrow('boom')
    await expect(second).rejects.toThrow('boom')
  })
})
