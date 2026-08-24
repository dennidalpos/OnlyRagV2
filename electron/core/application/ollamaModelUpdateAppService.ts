import { logger } from '../../diagnostics'
import { hasDigestDiscrepancy } from '../domain/ollama/modelUpdateChecker'
import { ollamaHttpClient } from '../infrastructure/http/ollamaHttpClient'
import { ollamaRegistryClient, type OllamaRegistryClient } from '../infrastructure/http/ollamaRegistryClient'

export interface ModelUpdateCheckResult {
  updateAvailable: boolean
  localDigest?: string
  remoteDigest?: string
  error?: string
}

export class OllamaModelUpdateAppService {
  private registryClient: OllamaRegistryClient
  private activeUpdatingModel: string | null = null

  constructor(registryClient: OllamaRegistryClient = ollamaRegistryClient) {
    this.registryClient = registryClient
  }

  /**
   * Returns the model currently being pulled/updated, or null if no update is in progress.
   */
  getActiveUpdatingModel(): string | null {
    return this.activeUpdatingModel
  }

  /**
   * Acquires the update lock for the specified model. Returns true if acquired, false if another model is updating.
   */
  acquireUpdateLock(modelName: string): boolean {
    if (this.activeUpdatingModel && this.activeUpdatingModel !== modelName) {
      return false
    }
    this.activeUpdatingModel = modelName
    return true
  }

  /**
   * Releases the update lock.
   */
  releaseUpdateLock(modelName?: string) {
    if (!modelName || this.activeUpdatingModel === modelName) {
      this.activeUpdatingModel = null
    }
  }

  /**
   * Checks all locally installed Ollama models for newer versions available in the official registry.
   * Compares SHA256 manifest digests without blocking.
   */
  async checkModelUpdates(host?: string): Promise<Record<string, ModelUpdateCheckResult>> {
    try {
      const localModels = await ollamaHttpClient.getModelTagsWithDigests(host)
      if (!localModels || localModels.length === 0) {
        return {}
      }

      logger.log('INFO', 'ModelUpdateAppService', `Checking updates for ${localModels.length} installed models...`)

      const results: Record<string, ModelUpdateCheckResult> = {}

      const checkPromises = localModels.map(async (m) => {
        const modelName = m.name
        const localDigest = m.digest

        if (!localDigest) {
          results[modelName] = { updateAvailable: false, localDigest: undefined }
          return
        }

        try {
          const remoteRes = await this.registryClient.fetchRemoteManifestDigest(modelName, 7000)
          if (remoteRes.success && remoteRes.digest) {
            const hasUpdate = hasDigestDiscrepancy(localDigest, remoteRes.digest)
            results[modelName] = {
              updateAvailable: hasUpdate,
              localDigest,
              remoteDigest: remoteRes.digest,
            }
            if (hasUpdate) {
              logger.log('INFO', 'ModelUpdateAppService', `Update available for model '${modelName}': local ${localDigest.slice(0, 12)} vs remote ${remoteRes.digest.slice(0, 12)}`)
            }
          } else {
            // Model not in registry (e.g. custom or 404) or timeout/offline
            results[modelName] = {
              updateAvailable: false,
              localDigest,
              error: remoteRes.error,
            }
          }
        } catch (err: any) {
          results[modelName] = {
            updateAvailable: false,
            localDigest,
            error: err.message,
          }
        }
      })

      await Promise.allSettled(checkPromises)
      return results
    } catch (err: any) {
      logger.log('WARN', 'ModelUpdateAppService', `Failed checking model updates: ${err.message}`)
      return {}
    }
  }
}

export const ollamaModelUpdateAppService = new OllamaModelUpdateAppService()
