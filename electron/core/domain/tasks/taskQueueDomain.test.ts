import { describe, it, expect } from 'vitest'
import { TaskQueueDomain } from './taskQueueDomain'

describe('TaskQueueDomain Unit Tests', () => {
  it('should enforce concurrency limit when popping tasks', () => {
    const queue = new TaskQueueDomain<string>(2)
    expect(queue.getMaxConcurrency()).toBe(2)

    queue.enqueue('t1', 'agent', 'payload 1')
    queue.enqueue('t2', 'agent', 'payload 2')
    queue.enqueue('t3', 'agent', 'payload 3')

    expect(queue.getQueuedCount()).toBe(3)
    expect(queue.getRunningCount()).toBe(0)

    const run1 = queue.popNext()
    expect(run1?.id).toBe('t1')
    expect(queue.getRunningCount()).toBe(1)
    expect(queue.getQueuedCount()).toBe(2)

    const run2 = queue.popNext()
    expect(run2?.id).toBe('t2')
    expect(queue.getRunningCount()).toBe(2)
    expect(queue.getQueuedCount()).toBe(1)

    // Concurrency limit reached (2/2)
    const run3 = queue.popNext()
    expect(run3).toBeNull()
    expect(queue.getRunningCount()).toBe(2)

    // Complete task 1 -> can now run task 3
    queue.markCompleted('t1')
    expect(queue.getRunningCount()).toBe(1)
    expect(queue.canRunNext()).toBe(true)

    const run3After = queue.popNext()
    expect(run3After?.id).toBe('t3')
    expect(queue.getRunningCount()).toBe(2)
    expect(queue.getQueuedCount()).toBe(0)
  })

  it('should clamp concurrency values between 1 and 8', () => {
    const queue = new TaskQueueDomain<string>(0)
    expect(queue.getMaxConcurrency()).toBe(1)

    queue.setMaxConcurrency(12)
    expect(queue.getMaxConcurrency()).toBe(8)

    queue.setMaxConcurrency(-5)
    expect(queue.getMaxConcurrency()).toBe(1)

    queue.setMaxConcurrency(4)
    expect(queue.getMaxConcurrency()).toBe(4)
  })

  it('should support cancellation of both running and queued tasks', () => {
    const queue = new TaskQueueDomain<string>(1)
    queue.enqueue('t1', 'agent', 'p1')
    queue.enqueue('t2', 'agent', 'p2')

    queue.popNext() // t1 is running
    expect(queue.getRunningCount()).toBe(1)
    expect(queue.getQueuedCount()).toBe(1)

    // Cancel queued task t2
    const cancelQueued = queue.cancel('t2')
    expect(cancelQueued.cancelled).toBe(true)
    expect(cancelQueued.wasRunning).toBe(false)
    expect(queue.getQueuedCount()).toBe(0)

    // Cancel running task t1
    const cancelRunning = queue.cancel('t1')
    expect(cancelRunning.cancelled).toBe(true)
    expect(cancelRunning.wasRunning).toBe(true)
    expect(queue.getRunningCount()).toBe(0)
  })

  it('should support cancelAll', () => {
    const queue = new TaskQueueDomain<string>(2)
    queue.enqueue('t1', 'agent', 'p1')
    queue.enqueue('t2', 'agent', 'p2')
    queue.enqueue('t3', 'agent', 'p3')
    queue.popNext()

    const res = queue.cancelAll()
    expect(res.cancelledCount).toBe(3)
    expect(queue.getRunningCount()).toBe(0)
    expect(queue.getQueuedCount()).toBe(0)
  })
})
