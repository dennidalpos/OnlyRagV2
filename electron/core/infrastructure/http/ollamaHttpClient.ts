import http from 'node:http'
import https from 'node:https'
import { logger } from '../../../diagnostics'
import type { RunningModelInfo, OllamaModelMetrics } from '../../../../shared/types'
import { consumeNdjsonChunk } from './ndjsonStreamParser'
import { httpMetrics } from './httpMetrics'
import { ollamaGenerationScheduler } from './ollamaGenerationScheduler'

export type { OllamaModelMetrics }

export interface OllamaStructuredRequest {
  operationId?: string
  model: string
  systemPrompt: string
  userContent: string
  format: Record<string, unknown>
  host?: string
  keepAlive?: string
  options?: {
    num_ctx?: number
    temperature?: number
    top_p?: number
    repeat_penalty?: number
    num_thread?: number
    num_predict?: number
  }
}

export type OllamaStructuredResponse =
  | { status: 'complete'; content: string; doneReason?: string }
  | { status: 'incomplete'; content: string; error: string }
  | { status: 'transport_error'; content: string; error: string }

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 })
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 })
type OllamaUrl = { protocol: 'http:' | 'https:'; hostname: string; port: number | string; path: string }

export interface RawOllamaTagModel {
  name?: string
  model?: string
  digest?: string
  modified_at?: string
  size?: number
  details?: {
    context_length?: number
    parameter_size?: string
    quantization_level?: string
    family?: string
    [key: string]: unknown
  }
  capabilities?: string[]
  [key: string]: unknown
}

export class OllamaHttpClient {
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
    const urlOpts = this.resolveUrl('/api/ps', customHost)

    const startedAt = Date.now()
    let recorded = false
    const record = (status: number, errorType: Parameters<typeof httpMetrics.record>[2]) => {
      if (recorded) return
      recorded = true
      httpMetrics.record('/api/ps', status, errorType, Date.now() - startedAt)
    }

    return new Promise((resolve) => {
      const req = this.request(urlOpts,
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
              record(res.statusCode || 0, 'http')
              resolve({ success: false, models: [], error: `Ollama HTTP ${res.statusCode}` })
              return
            }
            try {
              const parsed = JSON.parse(data)
              const models: RunningModelInfo[] = Array.isArray(parsed.models)
                ? parsed.models.map((model: RawOllamaTagModel) => ({
                    ...model,
                    context_length: typeof model?.context_length === 'number' ? model.context_length : undefined,
                  }))
                : []
              record(200, 'none')
              resolve({ success: true, models })
            } catch (err: any) {
              record(200, 'parse')
              resolve({ success: false, models: [], error: err.message })
            }
          })
        }
      )

      req.on('error', (err: any) => {
        record(0, 'network')
        resolve({ success: false, models: [], error: err.message })
      })

      req.setTimeout(5000, () => {
        req.destroy()
        record(0, 'timeout')
        resolve({ success: false, models: [], error: 'Ollama ps query timed out' })
      })

      req.end()
    })
  }

  /**
   * Fetches /api/tags and keeps everything Ollama reports per installed model, not just the
   * capabilities array.
   *
   * `getModelCapabilities` below reads the same endpoint and throws the rest away, which is why
   * the settings panel could only ever show a model's name: `details.context_length`,
   * `details.parameter_size` and `details.quantization_level` were fetched on every call and
   * discarded. `context_length` in particular is the number the app most needs and least has —
   * measured on 2026-08-24, Ollama silently clamps a requested `num_ctx` down to it and
   * silently truncates the HEAD of any prompt that exceeds it.
   *
   * Returns an empty map (never a rejection) on any failure: metrics are for display and must
   * not be able to break a settings screen.
   */
  /**
   * Internal shared HTTP data path for /api/tags.
   * Emits a single GET /api/tags request, records metrics, and parses the models array.
   * Returns an empty array (never throws/rejects) on any network, timeout, HTTP or JSON error.
   */
  private fetchRawModelTags(customHost?: string): Promise<RawOllamaTagModel[]> {
    const urlOpts = this.resolveUrl('/api/tags', customHost)
    const startedAt = Date.now()
    let recorded = false
    const record = (status: number, errorType: Parameters<typeof httpMetrics.record>[2]) => {
      if (recorded) return
      recorded = true
      httpMetrics.record('/api/tags', status, errorType, Date.now() - startedAt)
    }

    return new Promise((resolve) => {
      const req = this.request(urlOpts,
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
              record(res.statusCode || 0, 'http')
              resolve([])
              return
            }
            try {
              const parsed = JSON.parse(data)
              record(200, 'none')
              if (Array.isArray(parsed?.models)) {
                resolve(parsed.models)
              } else {
                resolve([])
              }
            } catch (err: any) {
              record(200, 'parse')
              logger.log('WARN', 'OllamaClient', `Failed parsing /api/tags JSON: ${err.message}`)
              resolve([])
            }
          })
        }
      )

      req.on('error', () => {
        record(0, 'network')
        resolve([])
      })
      req.setTimeout(5000, () => {
        req.destroy()
        record(0, 'timeout')
        resolve([])
      })
      req.end()
    })
  }

  /**
   * Fetches /api/tags and keeps everything Ollama reports per installed model, not just the
   * capabilities array.
   *
   * `getModelCapabilities` below reads the same endpoint and throws the rest away, which is why
   * the settings panel could only ever show a model's name: `details.context_length`,
   * `details.parameter_size` and `details.quantization_level` were fetched on every call and
   * discarded. `context_length` in particular is the number the app most needs and least has —
   * measured on 2026-08-24, Ollama silently clamps a requested `num_ctx` down to it and
   * silently truncates the HEAD of any prompt that exceeds it.
   *
   * Returns an empty map (never a rejection) on any failure: metrics are for display and must
   * not be able to break a settings screen.
   */
  async getModelMetrics(customHost?: string): Promise<Record<string, OllamaModelMetrics>> {
    const rawModels = await this.fetchRawModelTags(customHost)
    const map: Record<string, OllamaModelMetrics> = {}

    for (const m of rawModels) {
      const name = m?.name || m?.model
      if (!name) continue
      const details = m?.details || {}
      map[name] = {
        capabilities: Array.isArray(m?.capabilities) ? m.capabilities : [],
        contextLength: typeof details.context_length === 'number' ? details.context_length : undefined,
        parameterSize: typeof details.parameter_size === 'string' ? details.parameter_size : undefined,
        quantizationLevel: typeof details.quantization_level === 'string' ? details.quantization_level : undefined,
        family: typeof details.family === 'string' ? details.family : undefined,
        sizeBytes: typeof m?.size === 'number' ? m.size : undefined,
        digest: typeof m?.digest === 'string' ? m.digest : undefined,
      }
    }

    // `details.context_length` is not present in every Ollama version.
    // `/api/show` exposes the model's trained context in model_info, so
    // enrich the tag facts before returning them to the renderer.
    await Promise.all(
      Object.keys(map).map(async (name) => {
        const contextLength = await this.getModelContextLength(name, customHost)
        if (contextLength !== undefined) map[name].contextLength = contextLength
      })
    )

    return map
  }

  private getModelContextLength(modelName: string, customHost?: string): Promise<number | undefined> {
    const urlOpts = this.resolveUrl('/api/show', customHost)
    const postData = JSON.stringify({ model: modelName })
    return new Promise((resolve) => {
      const req = this.request(urlOpts, {
        hostname: urlOpts.hostname,
        port: urlOpts.port,
        path: urlOpts.path,
        method: 'POST',
        agent: httpAgent,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
      }, (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) return resolve(undefined)
            const parsed = JSON.parse(data)
            const candidates = [
              parsed?.details?.context_length,
              parsed?.model_info?.context_length,
              ...Object.entries(parsed?.model_info || {})
                .filter(([key]) => key.endsWith('.context_length'))
                .map(([, value]) => value),
            ]
            const value = candidates.find((candidate) => typeof candidate === 'number' && candidate > 0)
            resolve(typeof value === 'number' ? value : undefined)
          } catch {
            resolve(undefined)
          }
        })
      })
      req.on('error', () => resolve(undefined))
      req.setTimeout(5000, () => { req.destroy(); resolve(undefined) })
      req.write(postData)
      req.end()
    })
  }

  /**
   * Fetches /api/tags and returns installed models with their tag names and manifest digests.
   */
  async getModelTagsWithDigests(customHost?: string): Promise<Array<{ name: string; digest: string; modifiedAt?: string }>> {
    const rawModels = await this.fetchRawModelTags(customHost)
    const list: Array<{ name: string; digest: string; modifiedAt?: string }> = []
    for (const m of rawModels) {
      const name = m?.name || m?.model
      if (!name) continue
      list.push({
        name,
        digest: typeof m?.digest === 'string' ? m.digest : '',
        modifiedAt: typeof m?.modified_at === 'string' ? m.modified_at : undefined,
      })
    }
    return list
  }

  /**
   * Fetches /api/tags and extracts the `capabilities` array Ollama reports
   * per installed model (e.g. ["completion", "tools"]) — the authoritative
   * signal for native tool-calling support (see ollamaToolCallingCapability.ts).
   * Returns an empty map (not a rejection) on any failure, so callers fall
   * back to the family allow-list heuristic transparently.
   */
  async getModelCapabilities(customHost?: string): Promise<Record<string, string[]>> {
    const rawModels = await this.fetchRawModelTags(customHost)
    const map: Record<string, string[]> = {}
    for (const m of rawModels) {
      const name = m?.name || m?.model
      if (name && Array.isArray(m?.capabilities)) {
        map[name] = m.capabilities
      }
    }
    return map
  }

  unloadModel(modelName: string, customHost?: string): Promise<{ success: boolean; error?: string }> {
    if (!modelName || !modelName.trim()) {
      return Promise.resolve({ success: false, error: 'Invalid model name' })
    }
    const cleanModel = modelName.trim()
    const urlOpts = this.resolveUrl('/api/generate', customHost)
    logger.log('INFO', 'OllamaClient', `Requesting immediate model eviction (keep_alive: 0) for: ${cleanModel}`)

    return ollamaGenerationScheduler.schedule('unload', (setActiveCancel) =>
      this.unloadModelNow(cleanModel, urlOpts, setActiveCancel)
    ).promise
  }

  private unloadModelNow(cleanModel: string, urlOpts: OllamaUrl, setActiveCancel: (cancel: () => void) => void): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const postData = JSON.stringify({
        model: cleanModel,
        prompt: '',
        keep_alive: 0,
      })

      const req = this.request(urlOpts,
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
      setActiveCancel(() => req.destroy())

      req.setTimeout(10000, () => {
        req.destroy()
        resolve({ success: false, error: 'Model unload timed out' })
      })

      req.write(postData)
      req.end()
    })
  }

  /**
   * Loads a model into memory without generating anything (empty prompt + keep_alive),
   * the mirror image of unloadModel above. Called at agent-session start so the cold
   * load overlaps with prompt assembly (repo map scan, skill matching) instead of
   * racing the first turn's 45s initial-response timeout in agentStreamTransport.ts.
   * Always resolves — a failed warm-up is a missed optimisation, never a session error.
   */
  preloadModel(modelName: string, customHost?: string, keepAlive: string = '30m'): Promise<{ success: boolean; error?: string }> {
    if (!modelName || !modelName.trim()) {
      return Promise.resolve({ success: false, error: 'Invalid model name' })
    }
    const cleanModel = modelName.trim()
    const urlOpts = this.resolveUrl('/api/generate', customHost)

    return ollamaGenerationScheduler.schedule('preload', (setActiveCancel) =>
      this.preloadModelNow(cleanModel, keepAlive, urlOpts, setActiveCancel)
    ).promise
  }

  private preloadModelNow(cleanModel: string, keepAlive: string, urlOpts: OllamaUrl, setActiveCancel: (cancel: () => void) => void): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const postData = JSON.stringify({
        model: cleanModel,
        prompt: '',
        keep_alive: keepAlive,
      })

      const req = this.request(urlOpts,
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
            logger.log('INFO', 'OllamaClient', `Model ${cleanModel} warm-up completed. Status: HTTP ${res.statusCode}`)
            resolve({ success: res.statusCode === 200 })
          })
        }
      )

      req.on('error', (err: any) => {
        logger.log('WARN', 'OllamaClient', `Model warm-up skipped for ${cleanModel}: ${err.message}`)
        resolve({ success: false, error: err.message })
      })
      setActiveCancel(() => req.destroy())

      req.setTimeout(120000, () => {
        req.destroy()
        resolve({ success: false, error: 'Model warm-up timed out' })
      })

      req.write(postData)
      req.end()
    })
  }

  private resolveUrl(apiPath: string, host?: string): OllamaUrl {
    try {
      const u = new URL(apiPath, host || this.baseHost)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Unsupported protocol')
      return {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 11434),
        path: u.pathname,
      }
    } catch {
      return {
        protocol: 'http:',
        hostname: '127.0.0.1',
        port: 11434,
        path: apiPath,
      }
    }
  }

  private request(url: OllamaUrl, options: http.RequestOptions, listener: (response: http.IncomingMessage) => void): http.ClientRequest {
    const transport = url.protocol === 'https:' ? https : http
    return transport.request({ ...options, agent: url.protocol === 'https:' ? httpsAgent : httpAgent }, listener)
  }

  cancelStream(operationId: string): boolean {
    return ollamaGenerationScheduler.cancel(operationId)
  }

  getGenerationStatus() {
    return ollamaGenerationScheduler.getStatus()
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
    if (!modelName || typeof modelName !== 'string' || !modelName.trim()) {
      return Promise.resolve({ success: false, error: 'Invalid or empty model name' })
    }
    const cleanModelName = modelName.trim()
    logger.log('INFO', 'OllamaClient', `Requesting pull for model: ${cleanModelName}`)

    const urlOpts = this.resolveUrl('/api/pull', customHost)
    return new Promise((resolve) => {
      const postData = JSON.stringify({
        model: cleanModelName,
        name: cleanModelName,
        stream: true,
      })
      const req = this.request(urlOpts,
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
            req.setTimeout(900000)
            buffer = consumeNdjsonChunk(buffer, chunk, (parsed) => {
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
            })
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

  deleteModel(modelName: string, customHost?: string): Promise<{ success: boolean; error?: string }> {
    if (!modelName || typeof modelName !== 'string') {
      return Promise.resolve({ success: false, error: 'Invalid model name' })
    }
    logger.log('INFO', 'OllamaClient', `Requesting delete for model: ${modelName}`)
    const urlOpts = this.resolveUrl('/api/delete', customHost)
    return new Promise((resolve) => {
      const postData = JSON.stringify({ name: modelName.trim() })
      const req = this.request(urlOpts,
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
    customOptions?: { num_ctx?: number; temperature?: number; top_p?: number; repeat_penalty?: number; num_thread?: number; keep_alive?: string },
    customHost?: string,
    operationId?: string
  ): Promise<{ success: boolean; error?: string }> {
    if (typeof prompt !== 'string') return Promise.resolve({ success: false, error: 'Invalid prompt' })
    const urlOpts = this.resolveUrl('/api/generate', customHost)

    return ollamaGenerationScheduler.schedule(
      'stream',
      (setActiveCancel) => this.generateStreamNow(model, prompt, onChunk, onDone, customOptions, urlOpts, setActiveCancel),
      operationId
    ).promise
  }

  private generateStreamNow(
    model: string,
    prompt: string,
    onChunk: (chunk: string) => void,
    onDone: () => void,
    customOptions: { num_ctx?: number; temperature?: number; top_p?: number; repeat_penalty?: number; num_thread?: number; keep_alive?: string } | undefined,
    urlOpts: OllamaUrl,
    setActiveCancel: (cancel: () => void) => void
  ): Promise<{ success: boolean; error?: string }> {
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
      const req = this.request(urlOpts,
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
              resolve({ success: false, error: msg })
            })
            return
          }

          let buffer = ''
          let completed = false
          res.on('data', (chunk) => {
            buffer = consumeNdjsonChunk(
              buffer,
              chunk,
              (parsed) => {
                if (parsed.response) {
                  onChunk(parsed.response)
                }
                if (parsed.done === true) completed = true
              },
              (jsonErr) => {
                logger.log('WARN', 'OllamaClient', `Partial JSON stream chunk skipped: ${jsonErr.message}`)
              }
            )
          })
          res.on('end', () => {
            if (!completed) {
              resolve({ success: false, error: 'Ollama stream ended before completion.' })
              return
            }
            onDone()
            resolve({ success: true })
          })
        }
      )

      setActiveCancel(() => req.destroy())

      req.on('error', (err: any) => {
        const errMsg = err.code === 'ECONNREFUSED' ? 'Ollama service is not running locally (http://127.0.0.1:11434).' : err.message
        resolve({ success: false, error: errMsg })
      })

      req.setTimeout(600000, () => {
        req.destroy()
        resolve({ success: false, error: 'Generation timeout' })
      })

      req.write(postData)
      req.end()
    })
  }

  generateStructured(request: OllamaStructuredRequest): Promise<OllamaStructuredResponse> {
    if (!request.model.trim() || !request.systemPrompt.trim()) {
      return Promise.resolve({ status: 'transport_error', content: '', error: 'Invalid structured generation request' })
    }
    const urlOpts = this.resolveUrl('/api/chat', request.host)

    return ollamaGenerationScheduler.schedule('structured', (setActiveCancel) =>
      this.generateStructuredNow(request, urlOpts, setActiveCancel), request.operationId
    ).promise
  }

  cancelStructuredGeneration(operationId: string): boolean {
    return ollamaGenerationScheduler.cancel(operationId)
  }

  private generateStructuredNow(
    request: OllamaStructuredRequest,
    urlOpts: OllamaUrl,
    setActiveCancel: (cancel: () => void) => void
  ): Promise<OllamaStructuredResponse> {
    const postData = JSON.stringify({
      model: request.model,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userContent },
      ],
      format: request.format,
      stream: false,
      keep_alive: request.keepAlive || '30m',
      options: {
        num_ctx: request.options?.num_ctx || 16384,
        temperature: request.options?.temperature ?? 0.1,
        top_p: request.options?.top_p ?? 0.9,
        repeat_penalty: request.options?.repeat_penalty ?? 1.1,
        ...(request.options?.num_thread ? { num_thread: request.options.num_thread } : {}),
        ...(request.options?.num_predict ? { num_predict: request.options.num_predict } : {}),
      },
    })

    return new Promise((resolve) => {
      const startedAt = Date.now()
      let settled = false
      const finish = (result: OllamaStructuredResponse) => {
        if (settled) return
        settled = true
        httpMetrics.record(
          '/api/chat',
          result.status === 'transport_error' ? 0 : 200,
          result.status === 'complete' ? 'none' : result.status === 'incomplete' ? 'parse' : 'network',
          Date.now() - startedAt
        )
        resolve(result)
      }
      const req = this.request(urlOpts, {
        hostname: urlOpts.hostname,
        port: urlOpts.port,
        path: urlOpts.path,
        method: 'POST',
        agent: httpAgent,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      }, (res) => {
        let raw = ''
        res.on('data', (chunk) => { raw += chunk.toString() })
        res.on('end', () => {
          if (res.statusCode !== 200) {
            finish({ status: 'transport_error', content: '', error: `Ollama HTTP ${res.statusCode}: ${raw.slice(0, 200)}` })
            return
          }
          try {
            const parsed = JSON.parse(raw)
            const content = typeof parsed?.message?.content === 'string' ? parsed.message.content : ''
            if (parsed?.done !== true || parsed?.done_reason === 'length') {
              finish({ status: 'incomplete', content, error: `Ollama response incomplete${parsed?.done_reason ? ` (${parsed.done_reason})` : ''}` })
              return
            }
            finish({ status: 'complete', content, doneReason: parsed.done_reason })
          } catch (err: any) {
            finish({ status: 'transport_error', content: '', error: `Invalid Ollama response: ${err.message}` })
          }
        })
      })

      setActiveCancel(() => req.destroy())
      req.on('error', (err: any) => {
        const message = err.code === 'ECONNREFUSED'
          ? 'Ollama service is not running locally (http://127.0.0.1:11434).'
          : err.message
        finish({ status: 'transport_error', content: '', error: message })
      })
      req.setTimeout(600000, () => {
        req.destroy()
        finish({ status: 'transport_error', content: '', error: 'Structured generation timeout' })
      })
      req.write(postData)
      req.end()
    })
  }

  benchmarkModel(modelName: string, customHost?: string): Promise<{ success: boolean; tokensPerSec: number; evalCount: number; evalDurationMs: number; isEmbedding?: boolean; error?: string }> {
    if (!modelName || typeof modelName !== 'string') {
      return Promise.resolve({ success: false, tokensPerSec: 0, evalCount: 0, evalDurationMs: 0, error: 'Invalid model name' })
    }
    const cleanName = modelName.trim().toLowerCase()
    const isLikelyEmbedding = cleanName.includes('embed') || cleanName.includes('bge') || cleanName.includes('nomic') || cleanName.includes('minilm') || cleanName.includes('snowflake') || cleanName.includes('e5')

    logger.log('INFO', 'OllamaClient', `Starting performance benchmark for model: ${modelName} (isEmbedding: ${isLikelyEmbedding})`)

    if (isLikelyEmbedding) {
      const urlOpts = this.resolveUrl('/api/embeddings', customHost)
      return ollamaGenerationScheduler.schedule('benchmark', () => this.benchmarkEmbeddingModel(modelName.trim(), urlOpts)).promise
    }

    const urlOpts = this.resolveUrl('/api/generate', customHost)
    const embeddingUrlOpts = this.resolveUrl('/api/embeddings', customHost)
    return ollamaGenerationScheduler.schedule('benchmark', (setActiveCancel) =>
      this.benchmarkGenerationModel(modelName, urlOpts, embeddingUrlOpts, setActiveCancel)
    ).promise
  }

  private benchmarkGenerationModel(
    modelName: string,
    urlOpts: OllamaUrl,
    embeddingUrlOpts: OllamaUrl,
    setActiveCancel: (cancel: () => void) => void
  ): Promise<{ success: boolean; tokensPerSec: number; evalCount: number; evalDurationMs: number; isEmbedding?: boolean; error?: string }> {
    return new Promise((resolve) => {
      const benchmarkPrompt = 'Write a 40 word explanation of how gravity works.'
      const postData = JSON.stringify({
        model: modelName.trim(),
        prompt: benchmarkPrompt,
        stream: false,
        options: { num_predict: 50 },
      })

      const req = this.request(urlOpts,
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
                  this.benchmarkEmbeddingModel(modelName.trim(), embeddingUrlOpts).then(resolve)
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
      setActiveCancel(() => req.destroy())

      req.setTimeout(60000, () => {
        req.destroy()
        resolve({ success: false, tokensPerSec: 0, evalCount: 0, evalDurationMs: 0, error: 'Benchmark timeout' })
      })

      req.write(postData)
      req.end()
    })
  }

  private benchmarkEmbeddingModel(modelName: string, urlOpts = this.resolveUrl('/api/embeddings')): Promise<{ success: boolean; tokensPerSec: number; evalCount: number; evalDurationMs: number; isEmbedding?: boolean; error?: string }> {
    return new Promise((resolve) => {
      const startTime = Date.now()
      const postData = JSON.stringify({
        model: modelName,
        prompt: 'Benchmark semantic retrieval text for embedding generation throughput and vector latency testing.',
      })

      const req = this.request(urlOpts,
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
