import { BrowserWindow } from 'electron'
import { TaskQueueDomain, TaskQueueItem } from '../domain/tasks/taskQueueDomain'
import { runAgentOrchestratorLoop, cancelActiveAgentTask } from './agentOrchestratorAppService'
import type { AgentTaskPayload, AgentTaskResult } from '../domain/agent/agentTypes'
import { logger } from '../../diagnostics'

export interface QueuedAgentTask {
  id: string
  payload: AgentTaskPayload
  winGetter: () => BrowserWindow | null
  resolve: (result: AgentTaskResult) => void
  reject: (err: any) => void
}

/**
 * Agent tasks run strictly one at a time. Concurrency is not configurable: the tool
 * executor owns a single workspace journal and a shared pool of persistent shells, so a
 * second concurrent run would roll back the other run's writes on cancellation. Serial
 * execution is also the workspace rule (see AGENTS.md, "Strict Serial Execution").
 */
const AGENT_TASK_CONCURRENCY = 1

export class TaskQueueAppService {
  private queue = new TaskQueueDomain<QueuedAgentTask>(AGENT_TASK_CONCURRENCY)
  private isProcessing = false

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

  public async scheduleAgentTask(
    payload: AgentTaskPayload,
    winGetter: () => BrowserWindow | null
  ): Promise<AgentTaskResult> {
    const taskId = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`

    const taskData: QueuedAgentTask = {
      id: taskId,
      payload,
      winGetter,
      resolve: () => {},
      reject: () => {},
    }

    this.queue.enqueue(taskId, 'agent_task', taskData)

    const win = winGetter()
    const runningCount = this.queue.getRunningCount()
    const queuedCount = this.queue.getQueuedCount()

    if (runningCount >= this.queue.getMaxConcurrency()) {
      logger.log('INFO', 'TaskQueueAppService', `Task ${taskId} queued (Active: ${runningCount}/${this.queue.getMaxConcurrency()} | Queue depth: ${queuedCount})`)
      if (win && !win.isDestroyed()) {
        win.webContents.send('agent:log', {
          id: `${Date.now()}-queued`,
          timestamp: new Date().toISOString(),
          type: 'info',
          message: `Task aggiunto alla coda (#${queuedCount}) - Slot attivi: ${runningCount}/${this.queue.getMaxConcurrency()}`,
          detail: `Il task verrà avviato automaticamente non appena si libererà uno slot di esecuzione.`,
        })
      }
    }

    this.processQueue().catch((err) => {
      logger.log('ERROR', 'TaskQueueAppService', `Process queue error: ${err.message}`)
    })

    return { success: true, summary: 'Task scheduled successfully' }
  }

  public cancelTask(taskId?: string): { success: boolean; message: string } {
    if (taskId) {
      const res = this.queue.cancel(taskId)
      cancelActiveAgentTask(taskId)
      this.processQueue().catch(() => {})
      return {
        success: res.cancelled,
        message: res.cancelled ? `Task ${taskId} cancelled.` : `Task ${taskId} not found.`,
      }
    }

    const { cancelledCount } = this.queue.cancelAll()
    cancelActiveAgentTask()
    return {
      success: true,
      message: `All active and queued tasks cancelled (${cancelledCount} total).`,
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return
    this.isProcessing = true

    try {
      while (this.queue.canRunNext()) {
        const nextItem = this.queue.popNext()
        if (!nextItem) break

        this.executeTaskItem(nextItem).catch((err) => {
          logger.log('ERROR', 'TaskQueueAppService', `Unhandled execution failure for task ${nextItem.id}: ${err.message}`)
        })
      }
    } finally {
      this.isProcessing = false
    }
  }

  private async executeTaskItem(item: TaskQueueItem<QueuedAgentTask>): Promise<void> {
    const { id, payload } = item
    const { payload: taskPayload, winGetter, resolve, reject } = payload

    logger.log('INFO', 'TaskQueueAppService', `Starting task execution [${id}] with model '${taskPayload.activeModel || taskPayload.settings?.codingModel || 'default'}'`)

    try {
      const win = winGetter()
      const result = await runAgentOrchestratorLoop(taskPayload, win, id)
      this.queue.markCompleted(id)
      resolve(result)
    } catch (err: any) {
      this.queue.markFailed(id, err.message)
      logger.log('ERROR', 'TaskQueueAppService', `Task execution [${id}] failed: ${err.message}`)
      resolve({ success: false, summary: `Execution error: ${err.message}`, error: err.message })
    } finally {
      this.processQueue().catch(() => {})
    }
  }
}

export const taskQueueAppService = new TaskQueueAppService()
