import { taskRunner } from '../infrastructure/process/taskRunner'

export interface TaskRunnerPort {
  cancelTask(taskId: string): { success: boolean; message: string }
  cancelAllTasks(): void
}

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
