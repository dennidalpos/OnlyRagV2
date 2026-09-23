import { secureIpcMain as ipcMain } from './secureIpcMain'
import { systemAppService } from '../application/systemAppService'
import { taskAppService } from '../application/taskAppService'

export function registerSystemIpcHandlers() {
  ipcMain.handle(
    'dialog:open-file',
    async (_event: unknown, options?: { title?: string; filters?: { name: string; extensions: string[] }[] }) => {
      return systemAppService.openFileDialog(options)
    }
  )

  ipcMain.handle('dialog:open-directory', async (_event: unknown, options?: { title?: string }) => {
    return systemAppService.openDirectoryDialog(options)
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

}
