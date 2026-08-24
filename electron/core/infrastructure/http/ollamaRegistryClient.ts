import https from 'node:https'
import crypto from 'node:crypto'
import { logger } from '../../../diagnostics'
import { parseModelTag, type ParsedModelTarget } from '../../domain/ollama/modelUpdateChecker'

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 5 })

export interface RemoteManifestResult {
  success: boolean
  digest?: string
  statusCode?: number
  error?: string
}

export class OllamaRegistryClient {
  private registryBaseUrl: string = 'https://registry.ollama.ai'

  constructor(registryBaseUrl?: string) {
    if (registryBaseUrl) {
      this.registryBaseUrl = registryBaseUrl
    }
  }

  /**
   * Fetches the official OCI/Docker manifest from Ollama registry and calculates its SHA256 digest.
   *
   * @param modelInput Model name string (e.g. 'qwen2.5-coder:7b') or parsed model target.
   * @param timeoutMs Maximum request timeout in ms (default 6000ms).
   */
  fetchRemoteManifestDigest(
    modelInput: string | ParsedModelTarget,
    timeoutMs: number = 6000
  ): Promise<RemoteManifestResult> {
    const target = typeof modelInput === 'string' ? parseModelTag(modelInput) : modelInput

    if (!target.model) {
      return Promise.resolve({ success: false, error: 'Empty model name' })
    }

    const path = `/v2/${encodeURIComponent(target.namespace)}/${encodeURIComponent(target.model)}/manifests/${encodeURIComponent(target.tag)}`

    return new Promise((resolve) => {
      let url: URL
      try {
        url = new URL(path, this.registryBaseUrl)
      } catch (err: any) {
        return resolve({ success: false, error: `Invalid registry URL: ${err.message}` })
      }

      const req = https.request(
        {
          hostname: url.hostname,
          port: url.port || 443,
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          agent: httpsAgent,
          headers: {
            Accept: 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json',
            'User-Agent': 'ollama/0.5.0 (OnlyRag V2)',
          },
        },
        (res) => {
          const chunks: Buffer[] = []

          res.on('data', (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          })

          res.on('end', () => {
            const statusCode = res.statusCode || 0
            if (statusCode !== 200) {
              const msg = statusCode === 404
                ? `Model '${target.namespace}/${target.model}:${target.tag}' not found in registry (HTTP 404)`
                : `Registry returned HTTP ${statusCode}`
              return resolve({
                success: false,
                statusCode,
                error: msg,
              })
            }

            try {
              const bodyBuffer = Buffer.concat(chunks)
              const digest = crypto.createHash('sha256').update(bodyBuffer).digest('hex')
              resolve({
                success: true,
                statusCode: 200,
                digest,
              })
            } catch (err: any) {
              logger.log('WARN', 'OllamaRegistryClient', `Failed computing manifest digest for ${target.model}: ${err.message}`)
              resolve({
                success: false,
                statusCode: 200,
                error: err.message,
              })
            }
          })
        }
      )

      req.on('error', (err: any) => {
        logger.log('WARN', 'OllamaRegistryClient', `Network error querying registry for ${target.model}: ${err.message}`)
        resolve({
          success: false,
          error: err.message,
        })
      })

      req.setTimeout(timeoutMs, () => {
        req.destroy()
        logger.log('DEBUG', 'OllamaRegistryClient', `Registry manifest request timed out for ${target.model}`)
        resolve({
          success: false,
          error: 'Registry request timed out',
        })
      })

      req.end()
    })
  }
}

export const ollamaRegistryClient = new OllamaRegistryClient()
