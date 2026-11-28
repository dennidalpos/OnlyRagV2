/** Cancellation of running Main tasks; implemented by infrastructure/process/taskRunner. */
export interface TaskRunnerPort {
  cancelTask(taskId: string): { success: boolean; message: string }
  cancelAllTasks(): void
}
