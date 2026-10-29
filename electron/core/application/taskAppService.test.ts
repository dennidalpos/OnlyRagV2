import { describe, expect, it, vi } from 'vitest'
import { TaskAppService } from './taskAppService'
import type { TaskRunnerPort } from '../domain/ports/taskRunnerPort'

describe('TaskAppService', () => {
  it('delegates task cancellation and preserves the runner result', () => {
    const runner: TaskRunnerPort = {
      cancelTask: vi.fn().mockReturnValue({ success: true, message: 'cancelled' }),
      cancelAllTasks: vi.fn(),
    }
    const service = new TaskAppService(runner)

    expect(service.cancelTask('task-1')).toEqual({ success: true, message: 'cancelled' })
    expect(runner.cancelTask).toHaveBeenCalledWith('task-1')
  })

  it('returns the stable response after cancelling all tasks', () => {
    const runner: TaskRunnerPort = {
      cancelTask: vi.fn(),
      cancelAllTasks: vi.fn(),
    }
    const service = new TaskAppService(runner)

    expect(service.cancelAllTasks()).toEqual({ success: true, message: 'All active tasks cancelled.' })
    expect(runner.cancelAllTasks).toHaveBeenCalledOnce()
  })
})
