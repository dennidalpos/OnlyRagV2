import http from 'node:http'
import { logger } from '../../../diagnostics'
import type { RunningModelInfo } from '../../domain/ollama/lifecycleCoordinator'

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 })

export class OllamaHttpClient {
  private activeOllamaReq: http.ClientRequest | null = null
  private activePullReq: http.ClientRequest | null = null
  private baseHost: string = 'http://127.0.0.1:11434'

  setBaseHost(host?: string) {
    if (host && host.trim()) {
      const h = host.trim()
      this.baseHost = h.startsWith('http') ? h : `http://${h}`
    } else {
      this.baseHost = 'http://127.0.0.1:11434'
    }
  }

  getRunningModels(customHost?: string): Promise<{ success: boolean; models: RunningModelInfo[]; error?: string }> {
    if (customHost) this.setBaseHost(customHost)
    const urlOpts = this.resolveUrl('/api/ps')

    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: urlOpts.hostname,
          port: urlOpts.port,
          path: urlOpts.path,
          method: 'GET',
          agent: httpAgent,
        },
        (res) => {
          let data = ''
          res.on('data', (chunk) => { data += chunk })
          res.on('end', () => {
            if (res.statusCode !== 200) {
              resolve({ success: false, models: [], error: `Ollama HTTP ${res.statusCode}` })
              return
            }
            try {
              const parsed = JSON.parse(data)
              const models: RunningModelInfo[] = Array.isArray(parsed.models) ? parsed.models : []
              resolve({ success: true, models })
            } catch (err: any) {
              resolve({ success: false, models: [], error: err.message })
            }
          })
        }
      )

      req.on('error', (err: any) => {
        resolve({ success: false, models: [], error: err.message })
      })

      req.setTimeout(5000, () => {
        req.destroy()
        resolve({ success: false, models: [], error: 'Ollama ps query timed out' })
      })

      req.end()
    })
  }

  /**
   * Fetches /api/tags and extracts the `capabilities` array Ollama reports
   * per installed model (e.g. ["completion", "tools"]) — the authoritative
   * signal for native tool-calling support (see ollamaToolCallingCapability.ts).
   * Returns an empty map (not a rejection) on any failure, so callers fall
   * back to the family allow-list heuristic transparently.
   */
  getModelCapabilities(customHost?: string): Promise<Record<string, string[]>> {
    if (customHost) this.setBaseHost(customHost)
    const urlOpts = this.resolveUrl('/api/tags')

    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: urlOpts.hostname,
          port: urlOpts.port,
          path: urlOpts.path,
          method: 'GET',
          agent: httpAgent,
        },
        (res) => {
          let data = ''
          res.on('data', (chunk) => { data += chunk })
          res.on('end', () => {
            if (res.statusCode !== 200) {
              resolve({})
              return
            }
            try {
              const parsed = JSON.parse(data)
              const map: Record<string, string[]> = {}
              if (Array.isArray(parsed.models)) {
                for (const m of parsed.models) {
                  const name = m?.name || m?.model
                  if (name && Array.isArray(m?.capabilities)) {
                    map[name] = m.capabilities
                  }
                }
              }
              resolve(map)
            } catch (err: any) {
              logger.log('WARN', 'OllamaClient', `Failed parsing /api/tags capabilities: ${err.message}`)
              resolve({})
            }
          })
        }
      )

      req.on('error', () => resolve({}))
      req.setTimeout(5000, () => {
        req.destroy()
        resolve({})
      })
      req.end()
    })
  }

  unloadModel(modelName: string, customHost?: string): Promise<{ success: boolean; error?: string }> {
    if (customHost) this.setBaseHost(customHost)
    if (!modelName || !modelName.trim()) {
      return Promise.resolve({ success: false, error: 'Invalid model name' })
    }
    const cleanModel = modelName.trim()
    logger.log('INFO', 'OllamaClient', `Requesting immediate model eviction (keep_alive: 0) for: ${cleanModel}`)

    const urlOpts = this.resolveUrl('/api/generate')
    return new Promise((resolve) => {
      const postData = JSON.stringify({
        model: cleanModel,
        prompt: '',
        keep_alive: 0,
      })

      const req = http.request(
        {
          hostname: urlOpts.hostname,
          port: urlOpts.port,
          path: urlOpts.path,
          method: 'POST',
          agent: httpAgent,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          res.resume()
          res.on('end', () => {
            logger.log('INFO', 'OllamaClient', `Model ${cleanModel} evicted. Status: HTTP ${res.statusCode}`)
            resolve({ success: res.statusCode === 200 })
          })
        }
      )

      req.on('error', (err: any) => {
        logger.log('WARN', 'OllamaClient', `Failed to unload model ${cleanModel}: ${err.message}`)
        resolve({ success: false, error: err.message })
      })

      req.setTimeout(10000, () => {
        req.destroy()
        resolve({ success: false, error: 'Model unload timed out' })
      })

      req.write(postData)
      req.end()
    })
  }

  private resolveUrl(apiPath: string): { hostname: string; port: number | string; path: string } {
    try {
      const u = new URL(apiPath, this.baseHost)
      return {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 11434),
        path: u.pathname,
      }
    } catch {
      return {
        hostname: '127.0.0.1',
        port: 11434,
        path: apiPath,
      }
    }
  }

  cancelStream() {
    if (this.activeOllamaReq) {
      logger.log('INFO', 'OllamaClient', 'User requested cancellation of active Ollama stream.')
      try {
        this.activeOllamaReq.destroy()
      } catch (err: any) {
        logger.log('WARN', 'OllamaClient', `Error destroying active Ollama stream: ${err.message}`)
      }
      this.activeOllamaReq = null
    }
  }

  cancelPull() {
    if (this.activePullReq) {
      logger.log('INFO', 'OllamaClient', 'User requested cancellation of active Ollama model pull.')
      try {
        this.activePullReq.destroy()
      } catch (err: any) {
        logger.log('WARN', 'OllamaClient', `Error destroying active Ollama pull stream: ${err.message}`)
      }
      this.activePullReq = null
    }
  }

  pullModel(
    modelName: string,
    customHost?: string,
    onProgress?: (progress: { status: string; completed?: number; total?: number }) => void
  ): Promise<{ success: boolean; data?: string; error?: string }> {
    if (customHost) this.setBaseHost(customHost)
    if (!modelName || typeof modelName !== 'string' || !modelName.trim()) {
      return Promise.resolve({ success: false, error: 'Invalid or empty model name' })
    }
    const cleanModelName = modelName.trim()
    logger.log('INFO', 'OllamaClient', `Requesting pull for model: ${cleanModelName}`)

    const urlOpts = this.resolveUrl('/api/pull')
    return new Promise((resolve) => {
      const postData = JSON.stringify({
        model: cleanModelName,
        name: cleanModelName,
        stream: true,
      })
      const req = http.request(
        {
          hostname: urlOpts.hostname,
          port: urlOpts.port,
          path: urlOpts.path,
          method: 'POST',
          agent: httpAgent,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          let buffer = ''
          let lastStatus = ''
          let parsedError: string | undefined

          res.on('data', (chunk) => {
            buffer += chunk.toString()
            req.setTimeout(900000)

            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              if (line.trim()) {
                try {
                  const parsed = JSON.parse(line)
                  if (parsed.error) {
                    parsedError = parsed.error
                  }
                  if (parsed.status) {
                    lastStatus = parsed.status
                    if (onProgress) {
                      onProgress({
                        status: parsed.status,
                        completed: parsed.completed,
                        total: parsed.total,
                      })
                    }
                  }
                } catch {
                  // Partial chunk
                }
              }
            }
          })

          res.on('end', () => {
            this.activePullReq = null
            if (buffer.trim()) {
              try {
                const parsed = JSON.parse(buffer)
                if (parsed.error) parsedError = parsed.error
                if (parsed.status) lastStatus = parsed.status
              } catch (err: any) {
                logger.log('DEBUG', 'OllamaClient', `Trailing pull buffer was not complete JSON: ${err?.message}`)
              }
            }

            if (parsedError) {
              if (parsedError.includes('manifest') || parsedError.includes('file does not exist')) {
                parsedError = `Tag '${cleanModelName}' non trovato nel registro ufficiale Ollama (ollama.com/library). Dettaglio: ${parsedError}`
              }
            }

            logger.log('INFO', 'OllamaClient', `Model pull stream finished for ${cleanModelName}: HTTP ${res.statusCode}, status: ${lastStatus}`)

            const isSuccess = res.statusCode === 200 && !parsedError
            const finalErr = isSuccess
              ? undefined
              : parsedError || (res.statusCode !== 200 ? `Ollama HTTP ${res.statusCode}: ${lastStatus}` : 'Unknown pull error')

            if (!isSuccess) {
              logger.log('WARN', 'OllamaClient', `Model pull failed for ${cleanModelName}: ${finalErr}`)
            }

            resolve({ success: isSuccess, data: lastStatus, error: finalErr })
          })
        }
      )

      this.activePullReq = req

      req.on('error', (err: any) => {
        this.activePullReq = null
        const errMsg = err.code === 'ECONNREFUSED'
          ? 'Ollama service is not running locally (http://127.0.0.1:11434).'
          : err.message
        logger.log('ERROR', 'OllamaClient', `Error pulling model ${cleanModelName}: ${errMsg}`)
        resolve({ success: false, error: errMsg })
      })

      req.setTimeout(900000, () => {
        this.activePullReq = null
        req.destroy()
        logger.log('ERROR', 'OllamaClient', `Timeout pulling model ${cleanModelName}`)
        resolve({ success: false, error: `Model pull timed out (15 minute limit) for '${cleanModelName}'` })
      })

      req.write(postData)
      req.end()
    })
  }

  deleteModel(modelName: string): Promise<{ success: boolean; error?: string }> {
    if (!modelName || typeof modelName !== 'string') {
      return Promise.resolve({ success: false, error: 'Invalid model name' })
    }
    logger.log('INFO', 'OllamaClient', `Requesting delete for model: ${modelName}`)
    const urlOpts = this.resolveUrl('/api/delete')
    return new Promise((resolve) => {
      const postData = JSON.stringify({ name: modelName.trim() })
      const req = http.request(
        {
          hostname: urlOpts.hostname,
          port: urlOpts.port,
          path: urlOpts.path,
          method: 'DELETE',
          agent: httpAgent,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          logger.log('INFO', 'OllamaClient', `Model delete finished for ${modelName}: HTTP ${res.statusCode}`)
          resolve({ success: res.statusCode === 200 })
        }
      )
      req.on('error', (err) => {
        logger.log('ERROR', 'OllamaClient', `Error deleting model ${modelName}: ${err.message}`)
        resolve({ success: false, error: err.message })
      })
      req.write(postData)
      req.end()
    })
  }

  generateStream(
    model: string,
    prompt: string,
    onChunk: (chunk: string) => void,
    onDone: () => void,
    customOptions?: { num_ctx?: number; temperature?: number; top_p?: number; repeat_penalty?: number; num_thread?: number; keep_alive?: string }
  ): Promise<{ success: boolean; error?: string }> {
    if (typeof prompt !== 'string') return Promise.resolve({ success: false, error: 'Invalid prompt' })

    if (this.activeOllamaReq) {
      try {
        this.activeOllamaReq.destroy()
      } catch (err: any) {
        logger.log('WARN', 'OllamaClient', `Failed destroying existing active stream request: ${err.message}`)
      }
      this.activeOllamaReq = null
    }

    const urlOpts = this.resolveUrl('/api/generate')
    return new Promise((resolve) => {
      const postData = JSON.stringify({
        model: model || 'llama3.2',
        prompt,
        stream: true,
        keep_alive: customOptions?.keep_alive,
        options: {
          num_ctx: customOptions?.num_ctx || 16384,
          temperature: customOptions?.temperature ?? 0.1,
          top_p: customOptions?.top_p ?? 0.9,
          repeat_penalty: customOptions?.repeat_penalty ?? 1.1,
          ...(customOptions?.num_thread ? { num_thread: customOptions.num_thread } : {}),
        },
      })
      const req = http.request(
        {
          hostname: urlOpts.hostname,
          port: urlOpts.port,
          path: urlOpts.path,
          method: 'POST',
          agent: httpAgent,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          if (res.statusCode && res.statusCode !== 200) {
            let errBody = ''
            res.on('data', (chunk) => { errBody += chunk.toString() })
            res.on('end', () => {
              const msg = res.statusCode === 404 ? `Model '${model}' not pulled in Ollama.` : `Ollama HTTP Error ${res.statusCode}: ${errBody.slice(0, 200)}`
              onChunk(`\n[${msg}]`)
              onDone()
              resolve({ success: false, error: msg })
            })
            return
          }

          let buffer = ''
          res.on('data', (chunk) => {
            buffer += chunk.toString()
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''
            for (const line of lines) {
              if (line.trim()) {
                try {
                  const parsed = JSON.parse(line)
                  if (parsed.response) {
                    onChunk(parsed.response)
                  }
                } catch (jsonErr: any) {
                  logger.log('WARN', 'OllamaClient', `Partial JSON stream chunk skipped: ${jsonErr.message}`)
                }
              }
            }
          })
          res.on('end', () => {
            this.activeOllamaReq = null
            onDone()
            resolve({ success: true })
          })
        }
      )

      this.activeOllamaReq = req

      req.on('error', (err: any) => {
        this.activeOllamaReq = null
        const errMsg = err.code === 'ECONNREFUSED' ? 'Ollama service is not running locally (http://127.0.0.1:11434).' : err.message
        onChunk(`\n[Ollama Connection Error: ${errMsg}]`)
        onDone()
        resolve({ success: false, error: errMsg })
      })

      req.setTimeout(600000, () => {
        req.destroy()
        this.activeOllamaReq = null
        onChunk('\n[Generation Timed Out (600s limit)]')
        onDone()
        resolve({ success: false, error: 'Generation timeout' })
      })

      req.write(postData)
      req.end()
    })
  }

  benchmarkModel(modelName: string): Promise<{ success: boolean; tokensPerSec: number; evalCount: number; evalDurationMs: number; isEmbedding?: boolean; error?: string }> {
    if (!modelName || typeof modelName !== 'string') {
      return Promise.resolve({ success: false, tokensPerSec: 0, evalCount: 0, evalDurationMs: 0, error: 'Invalid model name' })
    }
    const cleanName = modelName.trim().toLowerCase()
    const isLikelyEmbedding = cleanName.includes('embed') || cleanName.includes('bge') || cleanName.includes('nomic') || cleanName.includes('minilm') || cleanName.includes('snowflake') || cleanName.includes('e5')

    logger.log('INFO', 'OllamaClient', `Starting performance benchmark for model: ${modelName} (isEmbedding: ${isLikelyEmbedding})`)

    if (isLikelyEmbedding) {
      return this.benchmarkEmbeddingModel(modelName.trim())
    }

    return new Promise((resolve) => {
      const benchmarkPrompt = 'Write a 40 word explanation of how gravity works.'
      const postData = JSON.stringify({
        model: modelName.trim(),
        prompt: benchmarkPrompt,
        stream: false,
        options: { num_predict: 50 },
      })

      const urlOpts = this.resolveUrl('/api/generate')
      const req = http.request(
        {
          hostname: urlOpts.hostname,
          port: urlOpts.port,
          path: urlOpts.path,
          method: 'POST',
          agent: httpAgent,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          let data = ''
          res.on('data', (chunk) => {
            data += chunk
          })
          res.on('end', () => {
            try {
              if (res.statusCode !== 200) {
                // If generate fails with embedding error, fallback to embedding benchmark
                if (data.includes('embedding') || data.includes('not support')) {
                  logger.log('INFO', 'OllamaClient', `Generate failed for ${modelName}, falling back to embedding benchmark`)
                  this.benchmarkEmbeddingModel(modelName.trim()).then(resolve)
                  return
                }
                resolve({ success: false, tokensPerSec: 0, evalCount: 0, evalDurationMs: 0, error: `HTTP ${res.statusCode}: ${data.slice(0, 100)}` })
                return
              }

              const parsed = JSON.parse(data)
              const evalCount = parsed.eval_count || 0
              const evalDurationNs = parsed.eval_duration || 1
              const evalDurationMs = Number((evalDurationNs / 1e6).toFixed(0))
              const evalDurationSec = evalDurationNs / 1e9
              const tokensPerSec = evalDurationSec > 0 ? Number((evalCount / evalDurationSec).toFixed(1)) : 0

              logger.log('INFO', 'OllamaClient', `Benchmark complete for ${modelName}: ${tokensPerSec} tokens/sec (${evalCount} tokens in ${evalDurationMs}ms)`)

              resolve({
                success: true,
                tokensPerSec,
                evalCount,
                evalDurationMs,
                isEmbedding: false,
              })
            } catch (err: any) {
              resolve({ success: false, tokensPerSec: 0, evalCount: 0, evalDurationMs: 0, error: err.message })
            }
          })
        }
      )

      req.on('error', (err) => {
        logger.log('ERROR', 'OllamaClient', `Error benchmarking model ${modelName}: ${err.message}`)
        resolve({ success: false, tokensPerSec: 0, evalCount: 0, evalDurationMs: 0, error: err.message })
      })

      req.setTimeout(60000, () => {
        req.destroy()
        resolve({ success: false, tokensPerSec: 0, evalCount: 0, evalDurationMs: 0, error: 'Benchmark timeout' })
      })

      req.write(postData)
      req.end()
    })
  }

  private benchmarkEmbeddingModel(modelName: string): Promise<{ success: boolean; tokensPerSec: number; evalCount: number; evalDurationMs: number; isEmbedding?: boolean; error?: string }> {
    return new Promise((resolve) => {
      const startTime = Date.now()
      const postData = JSON.stringify({
        model: modelName,
        prompt: 'Benchmark semantic retrieval text for embedding generation throughput and vector latency testing.',
      })

      const urlOpts = this.resolveUrl('/api/embeddings')
      const req = http.request(
        {
          hostname: urlOpts.hostname,
          port: urlOpts.port,
          path: urlOpts.path,
          method: 'POST',
          agent: httpAgent,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          let data = ''
          res.on('data', (chunk) => {
            data += chunk
          })
          res.on('end', () => {
            const evalDurationMs = Math.max(1, Date.now() - startTime)
            try {
              if (res.statusCode !== 200) {
                resolve({ success: false, tokensPerSec: 0, evalCount: 0, evalDurationMs, isEmbedding: true, error: `HTTP ${res.statusCode}` })
                return
              }
              const parsed = JSON.parse(data)
              const dimCount = Array.isArray(parsed.embedding) ? parsed.embedding.length : 1
              const vectorsPerSec = Number(((1000 / evalDurationMs)).toFixed(1))

              logger.log('INFO', 'OllamaClient', `Embedding benchmark complete for ${modelName}: ${vectorsPerSec} vec/sec (${evalDurationMs}ms, dim: ${dimCount})`)

              resolve({
                success: true,
                tokensPerSec: vectorsPerSec,
                evalCount: dimCount,
                evalDurationMs,
                isEmbedding: true,
              })
            } catch (err: any) {
              resolve({ success: false, tokensPerSec: 0, evalCount: 0, evalDurationMs, isEmbedding: true, error: err.message })
            }
          })
        }
      )

      req.on('error', (err) => {
        logger.log('ERROR', 'OllamaClient', `Error benchmarking embedding model ${modelName}: ${err.message}`)
        resolve({ success: false, tokensPerSec: 0, evalCount: 0, evalDurationMs: 0, isEmbedding: true, error: err.message })
      })

      req.setTimeout(60000, () => {
        req.destroy()
        resolve({ success: false, tokensPerSec: 0, evalCount: 0, evalDurationMs: 0, isEmbedding: true, error: 'Benchmark timeout' })
      })

      req.write(postData)
      req.end()
    })
  }
}

export const ollamaHttpClient = new OllamaHttpClient()
