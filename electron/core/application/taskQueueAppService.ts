import type { RendererEventSink } from '../domain/ports/rendererEventSink'
import PQueue from 'p-queue'
import { TaskQueueDomain, TaskQueueItem } from '../domain/tasks/taskQueueDomain'
import { runAgentOrchestratorLoop, cancelActiveAgentTask } from './agentOrchestratorAppService'
import type { AgentTaskPayload, AgentTaskResult } from '../domain/agent/agentTypes'
import { logger } from '../infrastructure/logging/logger'
import { createAgentRunIdentity } from '../../../shared/domain/agent/agentRunIdentity'
import { matchesAgentRunIdentity } from '../../../shared/domain/agent/agentRunIdentity'
import type { AgentRunIdentity } from '../../../shared/types'
import { standaloneScratchWorkspace } from '../infrastructure/filesystem/standaloneScratchWorkspace'
import { documentIoRepository } from '../infrastructure/filesystem/documentIoRepository'
import { ensureWorkspaceMetadataDirectory } from '../infrastructure/filesystem/workspaceMetadataDirectory'
import path from 'node:path'
import { errorMessage } from '../../../shared/domain/errors/errorMessage'

export interface QueuedAgentTask {
  id: string
  payload: AgentTaskPayload
  rendererEvents: RendererEventSink
}

/** Agent tasks run strictly one at a time. */
const AGENT_TASK_CONCURRENCY = 1

export class TaskQueueAppService {
  private queue = new TaskQueueDomain<QueuedAgentTask>(AGENT_TASK_CONCURRENCY)
  private pQueue = new PQueue({ concurrency: AGENT_TASK_CONCURRENCY })
  private shuttingDown = false
  private executions = new Map<string, Promise<void>>()

  constructor(private readonly resolveStandaloneWorkspacePath: () => string = () => standaloneScratchWorkspace.getPath()) {}

  public getMaxConcurrency(): number {
    return this.queue.getMaxConcurrency()
  }

  public getQueueStatus() {
    return {
      maxConcurrency: this.queue.getMaxConcurrency(),
      runningCount: this.queue.getRunningCount(),
      queuedCount: this.queue.getQueuedCount(),
      runningTasks: this.queue.getRunningTasks().map((t) => ({ id: t.id, type: t.type, status: t.status, createdAt: t.createdAt })),
      queuedTasks: this.queue.getQueuedTasks().map((t) => ({ id: t.id, type: t.type, status: t.status, createdAt: t.createdAt })),
    }
  }

  public async scheduleAgentTask(payload: AgentTaskPayload, rendererEvents: RendererEventSink): Promise<AgentTaskResult> {
    if (this.shuttingDown || !rendererEvents.isAvailable()) {
      return { success: false, summary: 'Agent renderer is unavailable or the application is shutting down.', completionStatus: 'cancelled' }
    }
    if (payload.identity?.conversationId && payload.sessionId && payload.identity.conversationId !== payload.sessionId) {
      return { success: false, summary: 'Agent run identity mismatch', error: 'conversationId does not match sessionId' }
    }

    let boundWorkspacePath: string
    try {
      if (payload.isStandaloneMode) {
        boundWorkspacePath = path.resolve(this.resolveStandaloneWorkspacePath())
      } else {
        const requestedWorkspace = payload.workspacePath?.trim()
        if (!requestedWorkspace) {
          return {
            success: false,
            summary: 'Project workspace is required',
            error: 'Select a project workspace or enable standalone mode before starting the agent.',
          }
        }
        boundWorkspacePath = path.resolve(requestedWorkspace)
      }
      if (!documentIoRepository.isDirectory(boundWorkspacePath)) {
        return {
          success: false,
          summary: 'Agent workspace is unavailable',
          error: `Workspace directory does not exist: ${boundWorkspacePath}`,
        }
      }
      ensureWorkspaceMetadataDirectory(boundWorkspacePath)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, summary: 'Agent workspace is unavailable', error: message }
    }

    const conversationId = payload.identity?.conversationId || payload.sessionId || `conversation-${Date.now()}`
    const identity = createAgentRunIdentity({
      ...payload.identity,
      conversationId,
      workspacePath: boundWorkspacePath,
    })
    const taskId = identity.runId
    const taskPayload: AgentTaskPayload = { ...payload, workspacePath: boundWorkspacePath, sessionId: conversationId, identity }

    if (this.queue.findTask(taskId)) {
      return { success: false, summary: 'Agent run already exists', error: `Duplicate runId: ${taskId}` }
    }

    const taskData: QueuedAgentTask = {
      id: taskId,
      payload: taskPayload,
      rendererEvents,
    }

    this.queue.enqueue(taskId, 'agent_task', taskData)

    const runningCount = this.queue.getRunningCount()
    const queuedCount = this.queue.getQueuedCount()
    const queuePosition = runningCount >= this.queue.getMaxConcurrency() ? queuedCount : 0

    if (runningCount >= this.queue.getMaxConcurrency()) {
      logger.log(
        'INFO',
        'TaskQueueAppService',
        `Task ${taskId} queued (Active: ${runningCount}/${this.queue.getMaxConcurrency()} | Queue depth: ${queuedCount})`,
      )
      rendererEvents.send('agent:log', {
        ...identity,
        id: `${Date.now()}-queued`,
        timestamp: new Date().toISOString(),
        type: 'info',
        message: `Task aggiunto alla coda (#${queuedCount}) - Slot attivi: ${runningCount}/${this.queue.getMaxConcurrency()}`,
        detail: `Il task verrà avviato automaticamente non appena si libererà uno slot di esecuzione.`,
      })
    }

    // Schedule into serial PQueue
    this.pQueue
      .add(async () => {
        const nextItem = this.queue.popNext()
        if (nextItem) {
          if (!nextItem.payload.rendererEvents.isAvailable()) {
            this.queue.cancel(nextItem.id)
            return
          }
          const execution = this.executeTaskItem(nextItem)
          this.executions.set(nextItem.id, execution)
          try {
            await execution
          } finally {
            this.executions.delete(nextItem.id)
          }
        }
      })
      .catch((err) => {
        logger.log('ERROR', 'TaskQueueAppService', `Process queue error: ${err.message}`)
      })

    return {
      success: true,
      summary: queuePosition > 0 ? `Task queued at position ${queuePosition}.` : 'Task accepted for execution.',
      runId: taskId,
      queuePosition,
    }
  }

  public cancelTask(target: AgentRunIdentity | string): { success: boolean; message: string } {
    const taskId = typeof target === 'string' ? target : target.runId
    const queued = this.queue.findTask(taskId)
    if (typeof target !== 'string' && queued && !matchesAgentRunIdentity(queued.payload.payload.identity, target)) {
      return { success: false, message: `Task ${taskId} identity mismatch.` }
    }
    const res = this.queue.cancel(taskId)
    cancelActiveAgentTask(taskId)
    return {
      success: res.cancelled,
      message: res.cancelled ? `Task ${taskId} cancelled.` : `Task ${taskId} not found.`,
    }
  }

  public async cancelRendererTasks(rendererEvents: RendererEventSink): Promise<void> {
    const items = [...this.queue.getQueuedTasks(), ...this.queue.getRunningTasks()].filter((item) => item.payload.rendererEvents === rendererEvents)
    const settlements: Promise<void>[] = []
    for (const item of items) {
      this.queue.cancel(item.id)
      settlements.push(cancelActiveAgentTask(item.id))
      const execution = this.executions.get(item.id)
      if (execution) settlements.push(execution)
    }
    await Promise.all(settlements)
  }

  public async shutdown(timeoutMs = 5000): Promise<void> {
    this.shuttingDown = true
    const cancellations = cancelActiveAgentTask()
    const executions = [...this.executions.values()]
    this.queue.cancelAll()
    this.pQueue.clear()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.allSettled([cancellations, ...executions, this.pQueue.onIdle()]).then((results) => {
          const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason as unknown)
          if (failures.length) throw new AggregateError(failures, 'Agent shutdown persistence failed.')
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Agent shutdown did not settle within ${timeoutMs}ms; recovery data is retained.`)), timeoutMs)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private async executeTaskItem(item: TaskQueueItem<QueuedAgentTask>): Promise<void> {
    const { id, payload } = item
    const { payload: taskPayload, rendererEvents } = payload

    logger.log(
      'INFO',
      'TaskQueueAppService',
      `Starting task execution [${id}] with model '${taskPayload.activeModel || taskPayload.settings?.codingModel || 'default'}'`,
    )

    try {
      // The run edits the user's workspace in place: its real node_modules, plan and session state
      // are there, and every changed file is recorded in a checkpoint the user can restore. The
      // former per-run copy left out node_modules and .onlyrag, so each run reinstalled dependencies
      // and could not see the approved plan.
      await runAgentOrchestratorLoop(taskPayload, rendererEvents, id)
      this.queue.markCompleted(id)
    } catch (err: unknown) {
      this.queue.markFailed(id, errorMessage(err))
      logger.log('ERROR', 'TaskQueueAppService', `Task execution [${id}] failed: ${errorMessage(err)}`)
      throw err
    }
  }
}

export const taskQueueAppService = new TaskQueueAppService()
