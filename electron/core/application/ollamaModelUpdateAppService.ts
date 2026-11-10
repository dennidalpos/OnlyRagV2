import { logger } from '../infrastructure/logging/logger'
import { hasDigestDiscrepancy } from '../domain/ollama/modelUpdateChecker'
import { ollamaHttpClient } from '../infrastructure/http/ollamaHttpClient'
import { ollamaRegistryClient, type OllamaRegistryClient } from '../infrastructure/http/ollamaRegistryClient'
import { errorMessage } from '../../../shared/domain/errors/errorMessage'

export interface ModelUpdateCheckResult {
  updateAvailable: boolean
  localDigest?: string
  remoteDigest?: string
  error?: string
}

export class OllamaModelUpdateAppService {
  private registryClient: OllamaRegistryClient
  private owner: { model: string; token: string } | null = null
  private operationCounter = 0

  constructor(registryClient: OllamaRegistryClient = ollamaRegistryClient) {
    this.registryClient = registryClient
  }

  /**
   * Returns the model currently being pulled/updated, or null if no update is in progress.
   */
  getActiveUpdatingModel(): string | null {
    return this.owner?.model ?? null
  }

  /**
   * Acquires the exclusive pull/update lock. Only one operation may hold it, even for the same model and
   * host. Returns an ownership token, or null when another operation already owns the lock.
   */
  acquireUpdateLock(modelName: string): string | null {
    if (this.owner) return null
    this.owner = { model: modelName, token: `pull-${++this.operationCounter}` }
    return this.owner.token
  }

  /**
   * Releases the lock. With a token it acts only on the operation that owns it, so a finished or cancelled
   * operation can never release its successor; without one (user cancel) it releases the current owner.
   */
  releaseUpdateLock(token?: string) {
    if (!this.owner) return
    if (token === undefined || this.owner.token === token) this.owner = null
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
              logger.log(
                'INFO',
                'ModelUpdateAppService',
                `Update available for model '${modelName}': local ${localDigest.slice(0, 12)} vs remote ${remoteRes.digest.slice(0, 12)}`,
              )
            }
          } else {
            // Model not in registry (e.g. custom or 404) or timeout/offline
            results[modelName] = {
              updateAvailable: false,
              localDigest,
              error: remoteRes.error,
            }
          }
        } catch (err: unknown) {
          results[modelName] = {
            updateAvailable: false,
            localDigest,
            error: errorMessage(err),
          }
        }
      })

      await Promise.allSettled(checkPromises)
      return results
    } catch (err: unknown) {
      logger.log('WARN', 'ModelUpdateAppService', `Failed checking model updates: ${errorMessage(err)}`)
      return {}
    }
  }
}

export const ollamaModelUpdateAppService = new OllamaModelUpdateAppService()
