import { ipcMain, BrowserWindow } from 'electron'
import { systemAppService } from '../application/systemAppService'
import { taskAppService } from '../application/taskAppService'

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

  ipcMain.handle('system:open-external', async (_, url: string) => {
    return systemAppService.openExternal(url)
  })

  ipcMain.handle('system:open-path', async (_, targetPath: string) => {
    return systemAppService.openPath(targetPath)
  })

  ipcMain.handle('task:cancel', async (_, taskId?: string) => {
    if (taskId) {
      return taskAppService.cancelTask(taskId)
    } else {
      return taskAppService.cancelAllTasks()
    }
  })

  ipcMain.handle('task:clean-residuals', async () => {
    return await taskAppService.cleanTempResiduals()
  })
}
