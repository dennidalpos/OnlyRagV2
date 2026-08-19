import { ipcMain } from 'electron'
import { projectRegistryAppService } from '../application/projectRegistryAppService'

export function registerProjectRegistryIpcHandlers() {
  ipcMain.handle('projects:list', async () => {
    return projectRegistryAppService.listProjects()
  })

  ipcMain.handle('projects:register', async (_event: unknown, projectPath: string, name?: string) => {
    return projectRegistryAppService.registerProject(projectPath, name)
  })

  ipcMain.handle('projects:touch', async (_event: unknown, projectPath: string) => {
    return projectRegistryAppService.touchProject(projectPath)
  })

  ipcMain.handle('projects:remove', async (_event: unknown, projectPath: string) => {
    return projectRegistryAppService.removeProject(projectPath)
  })

  ipcMain.handle('projects:migrate-legacy', async (_event: unknown, rawProjects: unknown) => {
    return projectRegistryAppService.migrateLegacyProjects(rawProjects)
  })
}
