import { beforeEach, describe, it, expect, vi } from 'vitest'

vi.mock('./agentOrchestratorAppService', () => ({
  runAgentOrchestratorLoop: vi.fn().mockResolvedValue({ success: true, summary: 'ok' }),
  cancelActiveAgentTask: vi.fn(),
}))

import { runAgentOrchestratorLoop } from './agentOrchestratorAppService'
import { TaskQueueAppService, taskQueueAppService } from './taskQueueAppService'

describe('TaskQueueAppService serial execution invariant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

  it('uses the immutable run identity as the queue and orchestrator key', async () => {
    const service = new TaskQueueAppService()
    const identity = {
      runId: 'run-1',
      conversationId: 'conversation-1',
      planRevisionId: 'plan-1:v1',
      workspaceId: 'workspace:D:\\repo',
    }

    await expect(service.scheduleAgentTask({
      identity,
      sessionId: identity.conversationId,
      userTask: 'Inspect the project',
      agentMode: 'ask',
      workspacePath: 'D:\\repo',
    }, () => null)).resolves.toMatchObject({ success: true })

    await vi.waitFor(() => {
      expect(runAgentOrchestratorLoop).toHaveBeenCalledWith(
        expect.objectContaining({ identity, sessionId: identity.conversationId }),
        null,
        identity.runId
      )
    })
  })
})
