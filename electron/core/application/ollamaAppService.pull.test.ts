import { afterEach, describe, expect, it, vi } from 'vitest'
import { ollamaAppService } from './ollamaAppService'
import { ollamaHttpClient } from '../infrastructure/http/ollamaHttpClient'
import { ollamaModelUpdateAppService } from './ollamaModelUpdateAppService'

describe('OllamaAppService pull ownership', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    ollamaModelUpdateAppService.releaseUpdateLock()
  })

  it('rejects a concurrent pull of the same model and keeps the owner until it finishes', async () => {
    let finishFirst: (value: { success: boolean }) => void = () => {}
    const pull = vi.spyOn(ollamaHttpClient, 'pullModel').mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)))

    const first = ollamaAppService.pullModel('model-a', 'http://127.0.0.1:1')
    const second = await ollamaAppService.pullModel('model-a', 'http://127.0.0.1:1')

    expect(second.success).toBe(false)
    expect(pull).toHaveBeenCalledTimes(1)
    expect(ollamaModelUpdateAppService.getActiveUpdatingModel()).toBe('model-a')

    finishFirst({ success: true })
    await first
    expect(ollamaModelUpdateAppService.getActiveUpdatingModel()).toBeNull()
  })

  it('lets the late completion of a cancelled pull leave its successor owning the lock', async () => {
    const finishers: Array<(value: { success: boolean }) => void> = []
    vi.spyOn(ollamaHttpClient, 'pullModel').mockImplementation(() => new Promise((resolve) => finishers.push(resolve)))
    vi.spyOn(ollamaHttpClient, 'cancelPull').mockImplementation(() => {})

    const cancelled = ollamaAppService.pullModel('model-a')
    ollamaAppService.cancelPullModel()
    const successor = ollamaAppService.pullModel('model-a')
    expect(finishers).toHaveLength(2)

    finishers[0]({ success: false })
    await cancelled
    expect(ollamaModelUpdateAppService.getActiveUpdatingModel()).toBe('model-a')
    expect((await ollamaAppService.pullModel('model-b')).success).toBe(false)

    finishers[1]({ success: true })
    await successor
    expect(ollamaModelUpdateAppService.getActiveUpdatingModel()).toBeNull()
  })
})
