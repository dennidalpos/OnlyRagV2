import { secureIpcMain as ipcMain } from './secureIpcMain'
import { ollamaAppService } from '../application/ollamaAppService'

export function registerOllamaIpcHandlers() {
  ipcMain.handle('ollama:install-or-launch', async () => {
    return ollamaAppService.installOrLaunchOllama()
  })

  ipcMain.handle('ollama:pull-model', async (event, { modelName, host }) => {
    return ollamaAppService.pullModel(modelName, host, (progress) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('ollama:pull-progress', { modelName, ...progress })
      }
    })
  })

  ipcMain.handle('ollama:cancel-pull', async () => {
    return ollamaAppService.cancelPullModel()
  })

  ipcMain.handle('ollama:delete-model', async (_, { modelName, host }) => {
    return ollamaAppService.deleteModel(modelName, host)
  })

  ipcMain.handle('ollama:cancel-stream', async (_, { operationId }) => {
    return { success: ollamaAppService.cancelStream(operationId) }
  })

  ipcMain.handle('ollama:get-generation-status', () => ollamaAppService.getGenerationStatus())

  ipcMain.handle('ollama:generate-stream', async (event, { model, prompt, options, host, operationId }) => {
    return ollamaAppService.generateStream(
      model,
      prompt,
      (chunk) => event.sender.send('ollama:chunk', { operationId, chunk }),
      () => event.sender.send('ollama:done', { operationId }),
      options,
      host,
      operationId,
    )
  })

  /**
   * Per-model facts from /api/tags — context length, capabilities, parameter size and
   * quantization — so the settings and wizard badges show measurements instead of a name.
   */
  ipcMain.handle('ollama:get-model-metrics', async (_, payload) => {
    return ollamaAppService.getModelMetrics(payload?.host)
  })

  ipcMain.handle('ollama:get-running-models', async (_, payload) => {
    return ollamaAppService.getRunningModels(payload?.host)
  })

  ipcMain.handle('ollama:unload-model', async (_, { modelName, host }) => {
    return ollamaAppService.unloadModel(modelName, host)
  })

  ipcMain.handle('ollama:test-connection', async (_, payload) => {
    return ollamaAppService.testConnection(payload?.host)
  })

  ipcMain.handle('ollama:check-model-updates', async (_, payload) => {
    return ollamaAppService.checkModelUpdates(payload?.host)
  })
}
