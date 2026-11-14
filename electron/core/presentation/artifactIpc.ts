import { secureIpcMain as ipcMain } from './secureIpcMain'
import { artifactAppService } from '../application/artifactAppService'

export function registerArtifactIpcHandlers() {
  ipcMain.handle('artifacts:list', async (_event, { workspacePath }) => {
    return artifactAppService.listArtifacts(workspacePath)
  })

  ipcMain.handle('artifacts:inspect', async (_event, { workspacePath }) => artifactAppService.inspectArtifacts(workspacePath))

  ipcMain.handle('artifacts:rebind', async (_event, { workspacePath, previousWorkspacePath, revision }) =>
    artifactAppService.rebindArtifacts(workspacePath, previousWorkspacePath, revision),
  )

  ipcMain.handle('artifacts:exportRejected', async (_event, { workspacePath, artifactId }) =>
    artifactAppService.exportRejectedArtifact(workspacePath, artifactId),
  )

  ipcMain.handle('artifacts:get', async (_event, { workspacePath, artifactId }) => {
    return artifactAppService.getArtifact(workspacePath, artifactId)
  })

  ipcMain.handle('artifacts:save', async (_event, { workspacePath, input }) => {
    return artifactAppService.saveArtifact(workspacePath, input)
  })

  ipcMain.handle('artifacts:delete', async (_event, { workspacePath, artifactId }) => {
    return artifactAppService.deleteArtifact(workspacePath, artifactId)
  })
}
