import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'

vi.mock('./agentOrchestratorAppService', () => ({
  runAgentOrchestratorLoop: vi.fn().mockResolvedValue({ success: true, summary: 'ok' }),
  cancelActiveAgentTask: vi.fn(),
}))

import { cancelActiveAgentTask, runAgentOrchestratorLoop } from './agentOrchestratorAppService'
import { TaskQueueAppService, taskQueueAppService } from './taskQueueAppService'

const noRenderer = { isAvailable: () => false, send: () => {} }

describe('TaskQueueAppService serial execution invariant', () => {
  const workspaces: string[] = []

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    while (workspaces.length) fs.rmSync(workspaces.pop()!, { recursive: true, force: true })
  })

  it('should run agent tasks strictly one at a time and expose no way to raise the limit', () => {
    // Runs remain serial so an active project cannot be staged twice at once.
    expect(taskQueueAppService.getMaxConcurrency()).toBe(1)
    expect(Reflect.get(taskQueueAppService, 'setMaxConcurrency')).toBeUndefined()
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
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-queue-workspace-'))
    workspaces.push(workspacePath)

    await expect(
      service.scheduleAgentTask(
        {
          identity,
          sessionId: identity.conversationId,
          userTask: 'Inspect the project',
          agentMode: 'ask',
          workspacePath,
        },
        noRenderer,
      ),
    ).resolves.toMatchObject({ success: true, runId: identity.runId, queuePosition: 0 })

    await vi.waitFor(() => {
      expect(runAgentOrchestratorLoop).toHaveBeenCalledWith(
        expect.objectContaining({ identity, sessionId: identity.conversationId }),
        noRenderer,
        identity.runId,
        expect.objectContaining({ sourcePath: workspacePath }),
      )
    })
  })

  it('returns a queued run ID and cancels only that queued run', async () => {
    const service = new TaskQueueAppService()
    let releaseFirst: (() => void) | undefined
    vi.mocked(runAgentOrchestratorLoop).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = () => resolve({ success: true, summary: 'first complete' })
        }),
    )
    const firstWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-queue-first-'))
    const secondWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-queue-second-'))
    workspaces.push(firstWorkspace, secondWorkspace)
    const first = {
      runId: 'run-first',
      conversationId: 'conversation-1',
      planRevisionId: 'plan-1:v1',
      workspaceId: 'workspace:first',
    }
    const second = { ...first, runId: 'run-second', workspaceId: 'workspace:second' }

    await service.scheduleAgentTask(
      { identity: first, sessionId: first.conversationId, userTask: 'First', agentMode: 'ask', workspacePath: firstWorkspace },
      noRenderer,
    )
    await vi.waitFor(() => expect(runAgentOrchestratorLoop).toHaveBeenCalledOnce())
    const accepted = await service.scheduleAgentTask(
      { identity: second, sessionId: second.conversationId, userTask: 'Second', agentMode: 'ask', workspacePath: secondWorkspace },
      noRenderer,
    )

    expect(accepted).toMatchObject({ success: true, runId: 'run-second', queuePosition: 1 })
    expect(service.cancelTask(second)).toEqual({ success: true, message: 'Task run-second cancelled.' })
    expect(cancelActiveAgentTask).toHaveBeenLastCalledWith('run-second')
    releaseFirst?.()
  })

  it('binds standalone runs to the authoritative scratch workspace, never the supplied installation path', async () => {
    const scratchPath = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-queue-scratch-'))
    workspaces.push(scratchPath)
    const service = new TaskQueueAppService(() => scratchPath)
    const identity = {
      runId: 'run-standalone',
      conversationId: 'conversation-standalone',
      planRevisionId: 'unplanned:standalone',
      workspaceId: 'standalone:conversation-standalone',
    }

    await expect(
      service.scheduleAgentTask(
        {
          identity,
          sessionId: identity.conversationId,
          userTask: 'Create index.html',
          agentMode: 'guided',
          workspacePath: 'C:\\Program Files\\OnlyRag V2',
          isStandaloneMode: true,
        },
        noRenderer,
      ),
    ).resolves.toMatchObject({ success: true, runId: identity.runId })

    await vi.waitFor(() => {
      expect(runAgentOrchestratorLoop).toHaveBeenCalledWith(
        expect.objectContaining({ workspacePath: scratchPath, isStandaloneMode: true }),
        noRenderer,
        identity.runId,
        undefined,
      )
    })
  })

  it('rejects a project run without an explicit workspace instead of falling back to process.cwd()', async () => {
    const service = new TaskQueueAppService()

    await expect(
      service.scheduleAgentTask(
        {
          sessionId: 'conversation-missing-workspace',
          userTask: 'Create src/App.tsx',
          agentMode: 'guided',
          workspacePath: null,
          isStandaloneMode: false,
        },
        noRenderer,
      ),
    ).resolves.toMatchObject({
      success: false,
      summary: 'Project workspace is required',
    })
    expect(runAgentOrchestratorLoop).not.toHaveBeenCalled()
  })
})
