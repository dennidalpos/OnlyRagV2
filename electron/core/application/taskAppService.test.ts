import { describe, expect, it, vi } from 'vitest'
import { TaskAppService, type TaskRunnerPort } from './taskAppService'

describe('TaskAppService', () => {
  it('delegates task cancellation and preserves the runner result', () => {
    const runner: TaskRunnerPort = {
      cancelTask: vi.fn().mockReturnValue({ success: true, message: 'cancelled' }),
      cancelAllTasks: vi.fn(),
      cleanTempResiduals: vi.fn(),
    }
    const service = new TaskAppService(runner)

    expect(service.cancelTask('task-1')).toEqual({ success: true, message: 'cancelled' })
    expect(runner.cancelTask).toHaveBeenCalledWith('task-1')
  })

  it('returns the stable response after cancelling all tasks', () => {
    const runner: TaskRunnerPort = {
      cancelTask: vi.fn(),
      cancelAllTasks: vi.fn(),
      cleanTempResiduals: vi.fn(),
    }
    const service = new TaskAppService(runner)

    expect(service.cancelAllTasks()).toEqual({ success: true, message: 'All active tasks cancelled.' })
    expect(runner.cancelAllTasks).toHaveBeenCalledOnce()
  })

  it('returns the cleanup result from the runner', async () => {
    const cleanup = { success: true, cleanedCount: 2, bytesFreed: 128 }
    const runner: TaskRunnerPort = {
      cancelTask: vi.fn(),
      cancelAllTasks: vi.fn(),
      cleanTempResiduals: vi.fn().mockResolvedValue(cleanup),
    }
    const service = new TaskAppService(runner)

    await expect(service.cleanTempResiduals()).resolves.toEqual(cleanup)
    expect(runner.cleanTempResiduals).toHaveBeenCalledOnce()
  })
})
