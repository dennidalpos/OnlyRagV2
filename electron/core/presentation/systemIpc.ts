import { ipcMain, BrowserWindow, shell } from 'electron'
import { systemAppService } from '../application/systemAppService'
import { taskRunner } from '../infrastructure/process/taskRunner'

export function registerSystemIpcHandlers(winGetter: () => BrowserWindow | null) {
  ipcMain.handle(
    'dialog:open-file',
    async (_event: unknown, options?: { title?: string; filters?: { name: string; extensions: string[] }[] }) => {
      const win = winGetter()
      return systemAppService.openFileDialog(win, options)
    }
  )

  ipcMain.handle('dialog:open-directory', async (_event: unknown, options?: { title?: string }) => {
    const win = winGetter()
    return systemAppService.openDirectoryDialog(win, options)
  })

  ipcMain.handle('system:check-disk-space', async (_, models: string[]) => {
    return systemAppService.validateModelDownloadSpace(models || [])
  })

  ipcMain.handle('system:apply-env-vars', async (_, variables: { name: string; value: string }[], restartOllama?: boolean) => {
    return systemAppService.applyOllamaEnvironmentVariables(variables, restartOllama)
  })

  ipcMain.handle('system:open-external', async (_, url: string) => {
    if (url && (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('mailto:'))) {
      await shell.openExternal(url)
      return true
    }
    return false
  })

  ipcMain.handle('task:cancel', async (_, taskId?: string) => {
    if (taskId) {
      return taskRunner.cancelTask(taskId)
    } else {
      taskRunner.cancelAllTasks()
      return { success: true, message: 'All active tasks cancelled.' }
    }
  })

  ipcMain.handle('task:clean-residuals', async () => {
    return await taskRunner.cleanTempResiduals()
  })
}

