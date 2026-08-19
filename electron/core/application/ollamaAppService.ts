import { checkOllamaStatus } from '../../diagnostics'
import { ollamaHttpClient } from '../infrastructure/http/ollamaHttpClient'
import { ollamaInstallerRepository } from '../infrastructure/process/ollamaInstallerRepository'

export class OllamaAppService {
  installOrLaunchOllama(): Promise<{ success: boolean; message?: string; error?: string }> {
    return ollamaInstallerRepository.installOrLaunch()
  }

  pullModel(modelName: string, onProgress?: (progress: { status: string; completed?: number; total?: number }) => void) {
    return ollamaHttpClient.pullModel(modelName, undefined, onProgress)
  }

  cancelPullModel() {
    ollamaHttpClient.cancelPull()
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

  benchmarkModel(modelName: string) {
    return ollamaHttpClient.benchmarkModel(modelName)
  }
}

export const ollamaAppService = new OllamaAppService()
