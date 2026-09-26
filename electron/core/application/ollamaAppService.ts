import { hardwareProbe } from '../infrastructure/diagnostics/hardwareProbe'
import type { OllamaGenerationOptions } from '../../../shared/types'
import { ollamaHttpClient, type OllamaModelMetrics, type OllamaStructuredRequest, type OllamaStructuredResponse } from '../infrastructure/http/ollamaHttpClient'
import { normalizeOllamaHost } from '../../../shared/domain/ollamaHost'
export type { OllamaModelMetrics, OllamaStructuredRequest, OllamaStructuredResponse }
import { ollamaInstallerRepository } from '../infrastructure/process/ollamaInstallerRepository'
import { ollamaModelUpdateAppService, type ModelUpdateCheckResult } from './ollamaModelUpdateAppService'
import { errorMessage } from '../../../shared/domain/errors/errorMessage'
export type { ModelUpdateCheckResult }

export class OllamaAppService {
  installOrLaunchOllama(): Promise<{ success: boolean; message?: string; error?: string }> {
    return ollamaInstallerRepository.installOrLaunch()
  }

  async pullModel(
    modelName: string,
    host?: string,
    onProgress?: (progress: { status: string; completed?: number; total?: number }) => void,
  ): Promise<{ success: boolean; data?: string; error?: string }> {
    if (!ollamaModelUpdateAppService.acquireUpdateLock(modelName)) {
      return {
        success: false,
        error: `Un altro modello (${ollamaModelUpdateAppService.getActiveUpdatingModel()}) è già in fase di aggiornamento o download.`,
      }
    }
    try {
      return await ollamaHttpClient.pullModel(modelName, host, onProgress)
    } finally {
      ollamaModelUpdateAppService.releaseUpdateLock(modelName)
    }
  }

  cancelPullModel() {
    ollamaHttpClient.cancelPull()
    ollamaModelUpdateAppService.releaseUpdateLock()
    return { success: true }
  }

  deleteModel(modelName: string, host?: string) {
    return ollamaHttpClient.deleteModel(modelName, host)
  }

  generateStream(
    model: string,
    prompt: string,
    onChunk: (chunk: string) => void,
    onDone: () => void,
    customOptions?: OllamaGenerationOptions,
    host?: string,
    operationId?: string,
  ) {
    return ollamaHttpClient.generateStream(model, prompt, onChunk, onDone, customOptions, host, operationId)
  }

  generateStructured(request: OllamaStructuredRequest): Promise<OllamaStructuredResponse> {
    return ollamaHttpClient.generateStructured(request)
  }

  cancelStructuredGeneration(operationId: string): boolean {
    return ollamaHttpClient.cancelStructuredGeneration(operationId)
  }

  async getInstalledModels(host?: string): Promise<string[]> {
    try {
      const status = await hardwareProbe.checkOllamaStatus(normalizeOllamaHost(host))
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

  getModelContextLength(model: string, host?: string): Promise<number | undefined> {
    return ollamaHttpClient.getModelContextLength(model, host)
  }

  /** Checks for model updates against official registry using SHA256 manifest digests. */
  checkModelUpdates(host?: string): Promise<Record<string, ModelUpdateCheckResult>> {
    return ollamaModelUpdateAppService.checkModelUpdates(host)
  }

  cancelStream(operationId: string) {
    return ollamaHttpClient.cancelStream(operationId)
  }

  getGenerationStatus() {
    return ollamaHttpClient.getGenerationStatus()
  }

  getRunningModels(host?: string) {
    return ollamaHttpClient.getRunningModels(host)
  }

  unloadModel(modelName: string, host?: string) {
    return ollamaHttpClient.unloadModel(modelName, host)
  }

  async testConnection(host?: string): Promise<{ success: boolean; version?: string; modelsCount?: number; error?: string }> {
    const targetHost = normalizeOllamaHost(host)
    try {
      const status = await hardwareProbe.checkOllamaStatus(targetHost)
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
    } catch (err: unknown) {
      return {
        success: false,
        error: errorMessage(err) || 'Errore durante la connessione al server Ollama',
      }
    }
  }
}

export const ollamaAppService = new OllamaAppService()
