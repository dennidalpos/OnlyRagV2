export type TaskStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'

export interface TaskQueueItem<T = any> {
  id: string
  type: string
  payload: T
  status: TaskStatus
  createdAt: number
  startedAt?: number
  completedAt?: number
  error?: string
}

export class TaskQueueDomain<T = any> {
  private queuedTasks: TaskQueueItem<T>[] = []
  private runningTasks: Map<string, TaskQueueItem<T>> = new Map()

  constructor(private maxConcurrency: number = 1) {
    this.setMaxConcurrency(maxConcurrency)
  }

  public setMaxConcurrency(limit: number): void {
    this.maxConcurrency = Math.max(1, Math.min(Math.floor(limit) || 1, 8))
  }

  public getMaxConcurrency(): number {
    return this.maxConcurrency
  }

  public enqueue(id: string, type: string, payload: T): TaskQueueItem<T> {
    const item: TaskQueueItem<T> = {
      id,
      type,
      payload,
      status: 'queued',
      createdAt: Date.now(),
    }
    this.queuedTasks.push(item)
    return item
  }

  public canRunNext(): boolean {
    return this.runningTasks.size < this.maxConcurrency && this.queuedTasks.length > 0
  }

  public popNext(): TaskQueueItem<T> | null {
    if (!this.canRunNext()) return null
    const next = this.queuedTasks.shift()
    if (!next) return null

    next.status = 'running'
    next.startedAt = Date.now()
    this.runningTasks.set(next.id, next)
    return next
  }

  public markCompleted(id: string): TaskQueueItem<T> | null {
    const item = this.runningTasks.get(id)
    if (item) {
      item.status = 'completed'
      item.completedAt = Date.now()
      this.runningTasks.delete(id)
      return item
    }
    return null
  }

  public markFailed(id: string, error: string): TaskQueueItem<T> | null {
    const item = this.runningTasks.get(id)
    if (item) {
      item.status = 'failed'
      item.error = error
      item.completedAt = Date.now()
      this.runningTasks.delete(id)
      return item
    }
    return null
  }

  public cancel(id: string): { cancelled: boolean; wasRunning: boolean } {
    if (this.runningTasks.has(id)) {
      const item = this.runningTasks.get(id)!
      item.status = 'cancelled'
      item.completedAt = Date.now()
      this.runningTasks.delete(id)
      return { cancelled: true, wasRunning: true }
    }

    const qIdx = this.queuedTasks.findIndex((t) => t.id === id)
    if (qIdx !== -1) {
      const [item] = this.queuedTasks.splice(qIdx, 1)
      item.status = 'cancelled'
      item.completedAt = Date.now()
      return { cancelled: true, wasRunning: false }
    }

    return { cancelled: false, wasRunning: false }
  }

  public cancelAll(): { cancelledCount: number } {
    const total = this.runningTasks.size + this.queuedTasks.length
    this.runningTasks.clear()
    this.queuedTasks = []
    return { cancelledCount: total }
  }

  public getRunningCount(): number {
    return this.runningTasks.size
  }

  public getQueuedCount(): number {
    return this.queuedTasks.length
  }

  public getRunningTasks(): TaskQueueItem<T>[] {
    return Array.from(this.runningTasks.values())
  }

  public getQueuedTasks(): TaskQueueItem<T>[] {
    return [...this.queuedTasks]
  }

  public findTask(id: string): TaskQueueItem<T> | null {
    return this.runningTasks.get(id) || this.queuedTasks.find((t) => t.id === id) || null
  }
}
