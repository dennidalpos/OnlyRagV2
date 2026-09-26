import { secureIpcMain as ipcMain } from './secureIpcMain'
import { projectRegistryAppService } from '../application/projectRegistryAppService'

export function registerProjectRegistryIpcHandlers() {
  ipcMain.handle('projects:list', async () => {
    return projectRegistryAppService.listProjects()
  })

  ipcMain.handle('projects:register', async (_event, { projectPath, name }) => {
    return projectRegistryAppService.registerProject(projectPath, name)
  })

  ipcMain.handle('projects:touch', async (_event, { projectPath }) => {
    return projectRegistryAppService.touchProject(projectPath)
  })

  ipcMain.handle('projects:rename', async (_event, { projectPath, name }) => {
    return projectRegistryAppService.renameProject(projectPath, name)
  })

  ipcMain.handle('projects:remove', async (_event, { projectPath }) => {
    return projectRegistryAppService.removeProject(projectPath)
  })
}
