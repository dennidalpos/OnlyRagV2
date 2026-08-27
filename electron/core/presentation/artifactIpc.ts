import { ipcMain } from 'electron'
import { artifactAppService } from '../application/artifactAppService'
import {
  artifactsDeletePayloadSchema,
  artifactsGetPayloadSchema,
  artifactsListPayloadSchema,
  artifactsSavePayloadSchema,
} from '../domain/artifactContract'

export function registerArtifactIpcHandlers() {
  ipcMain.handle('artifacts:list', async (_event, workspacePath: string) => {
    const payload = artifactsListPayloadSchema.parse({ workspacePath })
    return artifactAppService.listArtifacts(payload.workspacePath)
  })

  ipcMain.handle('artifacts:get', async (_event, workspacePath: string, artifactId: string) => {
    const payload = artifactsGetPayloadSchema.parse({ workspacePath, artifactId })
    return artifactAppService.getArtifact(payload.workspacePath, payload.artifactId)
  })

  ipcMain.handle('artifacts:save', async (_event, workspacePath: string, input: unknown) => {
    const payload = artifactsSavePayloadSchema.parse({ workspacePath, input })
    return artifactAppService.saveArtifact(payload.workspacePath, payload.input)
  })

  ipcMain.handle('artifacts:delete', async (_event, workspacePath: string, artifactId: string) => {
    const payload = artifactsDeletePayloadSchema.parse({ workspacePath, artifactId })
    return artifactAppService.deleteArtifact(payload.workspacePath, payload.artifactId)
  })
}
