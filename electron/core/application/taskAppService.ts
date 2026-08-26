import { taskRunner } from '../infrastructure/process/taskRunner'

export interface TaskRunnerPort {
  cancelTask(taskId: string): { success: boolean; message: string }
  cancelAllTasks(): void
  cleanTempResiduals(): Promise<{ success: boolean; cleanedCount: number; bytesFreed: number }>
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

  cleanTempResiduals(): Promise<{ success: boolean; cleanedCount: number; bytesFreed: number }> {
    return this.runner.cleanTempResiduals()
  }
}

export const taskAppService = new TaskAppService()
