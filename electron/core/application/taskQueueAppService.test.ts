import { describe, it, expect, vi } from 'vitest'

vi.mock('./agentOrchestratorAppService', () => ({
  runAgentOrchestratorLoop: vi.fn().mockResolvedValue({ success: true, summary: 'ok' }),
  cancelActiveAgentTask: vi.fn(),
}))

import { taskQueueAppService } from './taskQueueAppService'

describe('TaskQueueAppService serial execution invariant', () => {
  it('should run agent tasks strictly one at a time and expose no way to raise the limit', () => {
    // Concurrency is fixed by design: agentToolExecutorService owns a single workspace
    // journal and a shared pool of persistent shells, so a second concurrent run would
    // roll back the other run's writes on cancellation.
    expect(taskQueueAppService.getMaxConcurrency()).toBe(1)
    expect((taskQueueAppService as any).setMaxConcurrency).toBeUndefined()
  })

  it('should report a queue status consistent with the fixed serial limit', () => {
    const status = taskQueueAppService.getQueueStatus()
    expect(status.maxConcurrency).toBe(1)
    expect(status.runningCount).toBeLessThanOrEqual(1)
  })
})
