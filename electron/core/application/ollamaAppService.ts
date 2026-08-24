import { checkOllamaStatus } from '../../diagnostics'
import { ollamaHttpClient, type OllamaModelMetrics } from '../infrastructure/http/ollamaHttpClient'
export type { OllamaModelMetrics }
import { ollamaInstallerRepository } from '../infrastructure/process/ollamaInstallerRepository'
import { ollamaModelUpdateAppService, type ModelUpdateCheckResult } from './ollamaModelUpdateAppService'
export type { ModelUpdateCheckResult }

export class OllamaAppService {
  installOrLaunchOllama(): Promise<{ success: boolean; message?: string; error?: string }> {
    return ollamaInstallerRepository.installOrLaunch()
  }

  async pullModel(modelName: string, onProgress?: (progress: { status: string; completed?: number; total?: number }) => void): Promise<{ success: boolean; data?: string; error?: string }> {
    if (!ollamaModelUpdateAppService.acquireUpdateLock(modelName)) {
      return {
        success: false,
        error: `Un altro modello (${ollamaModelUpdateAppService.getActiveUpdatingModel()}) è già in fase di aggiornamento o download.`,
      }
    }
    try {
      return await ollamaHttpClient.pullModel(modelName, undefined, onProgress)
    } finally {
      ollamaModelUpdateAppService.releaseUpdateLock(modelName)
    }
  }

  cancelPullModel() {
    ollamaHttpClient.cancelPull()
    ollamaModelUpdateAppService.releaseUpdateLock()
    return { success: true }
  }

  deleteModel(modelName: string) {
    return ollamaHttpClient.deleteModel(modelName)
  }

  generateStream(
    model: string,
    prompt: string,
    onChunk: (chunk: string) => void,
    onDone: () => void,
    customOptions?: { num_ctx?: number; temperature?: number; top_p?: number; repeat_penalty?: number; num_thread?: number }
  ) {
    return ollamaHttpClient.generateStream(model, prompt, onChunk, onDone, customOptions)
  }

  async getInstalledModels(host?: string): Promise<string[]> {
    try {
      const status = await checkOllamaStatus(host || 'http://127.0.0.1:11434')
      return status.models || []
    } catch {
      return []
    }
  }

  /** Model name -> Ollama-reported capabilities (e.g. ["completion", "tools"]). */
  getModelCapabilities(host?: string): Promise<Record<string, string[]>> {
    return ollamaHttpClient.getModelCapabilities(host)
  }

  /** Everything /api/tags reports per model, for the settings and wizard badges. */
  getModelMetrics(host?: string): Promise<Record<string, OllamaModelMetrics>> {
    return ollamaHttpClient.getModelMetrics(host)
  }

  /** Checks for model updates against official registry using SHA256 manifest digests. */
  checkModelUpdates(host?: string): Promise<Record<string, ModelUpdateCheckResult>> {
    return ollamaModelUpdateAppService.checkModelUpdates(host)
  }

  /** Warms a model into memory ahead of the first turn. Never throws — see preloadModel. */
  preloadModel(modelName: string, host?: string): Promise<{ success: boolean; error?: string }> {
    return ollamaHttpClient.preloadModel(modelName, host)
  }

  cancelStream() {
    ollamaHttpClient.cancelStream()
  }

  getRunningModels(host?: string) {
    return ollamaHttpClient.getRunningModels(host)
  }

  unloadModel(modelName: string, host?: string) {
    return ollamaHttpClient.unloadModel(modelName, host)
  }

  async testConnection(host?: string): Promise<{ success: boolean; version?: string; modelsCount?: number; error?: string }> {
    const targetHost = host?.trim() || 'http://127.0.0.1:11434'
    try {
      const status = await checkOllamaStatus(targetHost)
      if (status.status === 'online') {
        return {
          success: true,
          modelsCount: status.modelsCount,
        }
      }
      return {
        success: false,
        error: status.error || 'Server Ollama non raggiungibile',
      }
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Errore durante la connessione al server Ollama',
      }
    }
  }

  benchmarkModel(modelName: string) {
    return ollamaHttpClient.benchmarkModel(modelName)
  }
}

export const ollamaAppService = new OllamaAppService()
