import { taskRunner } from '../infrastructure/process/taskRunner'
import type { TaskRunnerPort } from '../domain/ports/taskRunnerPort'

export class TaskAppService {
  constructor(private readonly runner: TaskRunnerPort = taskRunner) {}

  cancelTask(taskId: string): { success: boolean; message: string } {
    return this.runner.cancelTask(taskId)
  }

  cancelAllTasks(): { success: boolean; message: string } {
    this.runner.cancelAllTasks()
    return { success: true, message: 'All active tasks cancelled.' }
  }
}

export const taskAppService = new TaskAppService()
