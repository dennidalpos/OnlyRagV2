import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import { ollamaAppService } from '../application/ollamaAppService'

export function registerOllamaIpcHandlers() {
  ipcMain.handle('ollama:install-or-launch', async () => {
    return ollamaAppService.installOrLaunchOllama()
  })

  ipcMain.handle('ollama:pull-model', async (event, modelName: string, host?: string) => {
    return ollamaAppService.pullModel(modelName, host, (progress) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('ollama:pull-progress', { modelName, ...progress })
      }
    })
  })

  ipcMain.handle('ollama:cancel-pull', async () => {
    return ollamaAppService.cancelPullModel()
  })

  ipcMain.handle('ollama:delete-model', async (_, modelName: string, host?: string) => {
    return ollamaAppService.deleteModel(modelName, host)
  })

  ipcMain.handle('ollama:cancel-stream', async (_, operationId: string) => {
    return { success: ollamaAppService.cancelStream(operationId) }
  })

  ipcMain.handle('ollama:get-generation-status', () => ollamaAppService.getGenerationStatus())

  ipcMain.handle('ollama:generate-stream', async (event, model: string, prompt: string, options?: any, host?: string, operationId?: string) => {
    const streamId = operationId || randomUUID()
    return ollamaAppService.generateStream(
      model,
      prompt,
      (chunk) => event.sender.send('ollama:chunk', { operationId: streamId, chunk }),
      () => event.sender.send('ollama:done', { operationId: streamId }),
      options,
      host,
      streamId
    )
  })

  ipcMain.handle('ollama:benchmark-model', async (_, modelName: string, host?: string) => {
    return ollamaAppService.benchmarkModel(modelName, host)
  })

  /**
   * Per-model facts from /api/tags — context length, capabilities, parameter size and
   * quantization — so the settings and wizard badges show measurements instead of a name.
   */
  ipcMain.handle('ollama:get-model-metrics', async (_, host?: string) => {
    return ollamaAppService.getModelMetrics(host)
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

  ipcMain.handle('ollama:check-model-updates', async (_, host?: string) => {
    return ollamaAppService.checkModelUpdates(host)
  })
}
