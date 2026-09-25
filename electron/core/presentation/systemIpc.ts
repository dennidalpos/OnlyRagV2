import { secureIpcMain as ipcMain } from './secureIpcMain'
import { systemAppService } from '../application/systemAppService'
import { taskAppService } from '../application/taskAppService'

export function registerSystemIpcHandlers() {
  ipcMain.handle('dialog:open-file', async (_event, options) => {
    return systemAppService.openFileDialog(options)
  })

  ipcMain.handle('dialog:open-directory', async (_event, options) => {
    return systemAppService.openDirectoryDialog(options)
  })

  ipcMain.handle('system:check-disk-space', async (_, { models }) => {
    return systemAppService.validateModelDownloadSpace(models)
  })

  ipcMain.handle('system:open-external', async (_, { url }) => {
    return systemAppService.openExternal(url)
  })

  ipcMain.handle('system:open-path', async (_, { targetPath }) => {
    return systemAppService.openPath(targetPath)
  })

  ipcMain.handle('task:cancel', async (_, payload) => {
    return payload?.taskId ? taskAppService.cancelTask(payload.taskId) : taskAppService.cancelAllTasks()
  })
}
