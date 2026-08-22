import { ipcMain } from 'electron'
import { ollamaAppService } from '../application/ollamaAppService'

export function registerOllamaIpcHandlers() {
  ipcMain.handle('ollama:install-or-launch', async () => {
    return ollamaAppService.installOrLaunchOllama()
  })

  ipcMain.handle('ollama:pull-model', async (event, modelName: string) => {
    return ollamaAppService.pullModel(modelName, (progress) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('ollama:pull-progress', { modelName, ...progress })
      }
    })
  })

  ipcMain.handle('ollama:cancel-pull', async () => {
    return ollamaAppService.cancelPullModel()
  })

  ipcMain.handle('ollama:delete-model', async (_, modelName: string) => {
    return ollamaAppService.deleteModel(modelName)
  })

  ipcMain.handle('ollama:cancel-stream', async () => {
    ollamaAppService.cancelStream()
    return { success: true }
  })

  ipcMain.handle('ollama:generate-stream', async (event, model: string, prompt: string, options?: any) => {
    return ollamaAppService.generateStream(
      model,
      prompt,
      (chunk) => event.sender.send('ollama:chunk', chunk),
      () => event.sender.send('ollama:done'),
      options
    )
  })

  ipcMain.handle('ollama:benchmark-model', async (_, modelName: string) => {
    return ollamaAppService.benchmarkModel(modelName)
  })

  ipcMain.handle('ollama:get-running-models', async (_, host?: string) => {
    return ollamaAppService.getRunningModels(host)
  })

  ipcMain.handle('ollama:unload-model', async (_, modelName: string, host?: string) => {
    return ollamaAppService.unloadModel(modelName, host)
  })

  ipcMain.handle('ollama:test-connection', async (_, host?: string) => {
    return ollamaAppService.testConnection(host)
  })
}
