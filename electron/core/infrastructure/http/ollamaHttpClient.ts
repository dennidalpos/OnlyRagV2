import http from 'node:http'
import { logger } from '../logging/logger'
import type { RunningModelInfo, OllamaGenerationOptions, OllamaModelMetrics } from '../../../../shared/types'
import { consumeNdjsonChunk } from './ndjsonStreamParser'
import { ollamaGenerationScheduler } from './ollamaGenerationScheduler'
import { resolveOllamaUrl, requestOllama, type OllamaUrl } from './ollamaTransport'
import { DEFAULT_OLLAMA_HOST, normalizeOllamaHost } from '../../../../shared/domain/ollamaHost'
import { errorMessage } from '../../../../shared/domain/errors/errorMessage'

export type { OllamaModelMetrics }

export interface OllamaStructuredRequest {
  operationId?: string
  model: string
  systemPrompt: string
  userContent: string
  format: Record<string, unknown>
  host?: string
  keepAlive?: string
  /** Structured JSON does not benefit from hidden reasoning; level-only models take their lowest level. */
  think?: boolean | 'low' | 'medium' | 'high'
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
  | { status: 'complete'; content: string; doneReason?: string; promptEvalCount?: number; evalCount?: number; thinkingChars?: number }
  | { status: 'incomplete'; content: string; error: string; doneReason?: string; promptEvalCount?: number; evalCount?: number; thinkingChars?: number }
  | { status: 'transport_error'; content: string; error: string }

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
  private baseHost: string = DEFAULT_OLLAMA_HOST

  setBaseHost(host?: string) {
    this.baseHost = normalizeOllamaHost(host)
  }

  getRunningModels(customHost?: string): Promise<{ success: boolean; models: RunningModelInfo[]; error?: string }> {
    const urlOpts = this.resolveUrl('/api/ps', customHost)

    return new Promise((resolve) => {
      const req = this.request(
        urlOpts,
        {
          hostname: urlOpts.hostname,
          port: urlOpts.port,
          path: urlOpts.path,
          method: 'GET',
        },
        (res) => {
          let data = ''
          res.on('data', (chunk) => {
            data += chunk
          })
          res.on('end', () => {
            if (res.statusCode !== 200) {
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
              resolve({ success: true, models })
            } catch (err: unknown) {
              resolve({ success: false, models: [], error: errorMessage(err) })
            }
          })
        },
      )

      req.on('error', (err: NodeJS.ErrnoException) => {
        resolve({ success: false, models: [], error: err.message })
      })

      req.setTimeout(5000, () => {
        req.destroy()
        resolve({ success: false, models: [], error: 'Ollama ps query timed out' })
      })

      req.end()
    })
  }

  /** Fetches /api/tags and keeps everything Ollama reports per installed model, not just the capabilities array. */
  /** Internal shared HTTP data path for /api/tags. */
  private fetchRawModelTags(customHost?: string): Promise<RawOllamaTagModel[]> {
    const urlOpts = this.resolveUrl('/api/tags', customHost)

    return new Promise((resolve) => {
      const req = this.request(
        urlOpts,
        {
          hostname: urlOpts.hostname,
          port: urlOpts.port,
          path: urlOpts.path,
          method: 'GET',
        },
        (res) => {
          let data = ''
          res.on('data', (chunk) => {
            data += chunk
          })
          res.on('end', () => {
            if (res.statusCode !== 200) {
              resolve([])
              return
            }
            try {
              const parsed = JSON.parse(data)
              if (Array.isArray(parsed?.models)) {
                resolve(parsed.models)
              } else {
                resolve([])
              }
            } catch (err: unknown) {
              logger.log('WARN', 'OllamaClient', `Failed parsing /api/tags JSON: ${errorMessage(err)}`)
              resolve([])
            }
          })
        },
      )

      req.on('error', () => {
        resolve([])
      })
      req.setTimeout(5000, () => {
        req.destroy()
        resolve([])
      })
      req.end()
    })
  }

  /** Fetches /api/tags and keeps everything Ollama reports per installed model, not just the capabilities array. */
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
    await Promise.all(
      Object.keys(map).map(async (name) => {
        const contextLength = await this.getModelContextLength(name, customHost)
        if (contextLength !== undefined) map[name].contextLength = contextLength
      }),
    )

    return map
  }

  getModelContextLength(modelName: string, customHost?: string): Promise<number | undefined> {
    const urlOpts = this.resolveUrl('/api/show', customHost)
    const postData = JSON.stringify({ model: modelName })
    return new Promise((resolve) => {
      const req = this.request(
        urlOpts,
        {
          hostname: urlOpts.hostname,
          port: urlOpts.port,
          path: urlOpts.path,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
        },
        (res) => {
          let data = ''
          res.on('data', (chunk) => {
            data += chunk
          })
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
        },
      )
      req.on('error', () => resolve(undefined))
      req.setTimeout(5000, () => {
        req.destroy()
        resolve(undefined)
      })
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

  /** Fetches /api/tags and extracts the `capabilities` array Ollama reports per installed model (e.g. */
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

    return ollamaGenerationScheduler.schedule('unload', (setActiveCancel) => this.unloadModelNow(cleanModel, urlOpts, setActiveCancel)).promise
  }

  private unloadModelNow(cleanModel: string, urlOpts: OllamaUrl, setActiveCancel: (cancel: () => void) => void): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const postData = JSON.stringify({
        model: cleanModel,
        prompt: '',
        keep_alive: 0,
      })

      const req = this.request(
        urlOpts,
        {
          hostname: urlOpts.hostname,
          port: urlOpts.port,
          path: urlOpts.path,
          method: 'POST',
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
        },
      )

      req.on('error', (err: NodeJS.ErrnoException) => {
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

  /** Loads a model into memory without generating anything (empty prompt + keep_alive), the mirror image of unloadModel above. */
  preloadModel(modelName: string, customHost?: string, keepAlive: string = '30m'): Promise<{ success: boolean; error?: string }> {
    if (!modelName || !modelName.trim()) {
      return Promise.resolve({ success: false, error: 'Invalid model name' })
    }
    const cleanModel = modelName.trim()
    const urlOpts = this.resolveUrl('/api/generate', customHost)

    return ollamaGenerationScheduler.schedule('preload', (setActiveCancel) => this.preloadModelNow(cleanModel, keepAlive, urlOpts, setActiveCancel)).promise
  }

  private preloadModelNow(
    cleanModel: string,
    keepAlive: string,
    urlOpts: OllamaUrl,
    setActiveCancel: (cancel: () => void) => void,
  ): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const postData = JSON.stringify({
        model: cleanModel,
        prompt: '',
        keep_alive: keepAlive,
      })

      const req = this.request(
        urlOpts,
        {
          hostname: urlOpts.hostname,
          port: urlOpts.port,
          path: urlOpts.path,
          method: 'POST',
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
        },
      )

      req.on('error', (err: NodeJS.ErrnoException) => {
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
    return resolveOllamaUrl(apiPath, host || this.baseHost)
  }

  private request(url: OllamaUrl, options: http.RequestOptions, listener: (response: http.IncomingMessage) => void): http.ClientRequest {
    return requestOllama(url, options, listener)
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
      } catch (err: unknown) {
        logger.log('WARN', 'OllamaClient', `Error destroying active Ollama pull stream: ${errorMessage(err)}`)
      }
      this.activePullReq = null
    }
  }

  pullModel(
    modelName: string,
    customHost?: string,
    onProgress?: (progress: { status: string; completed?: number; total?: number }) => void,
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
      const req = this.request(
        urlOpts,
        {
          hostname: urlOpts.hostname,
          port: urlOpts.port,
          path: urlOpts.path,
          method: 'POST',
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
              } catch (err: unknown) {
                logger.log('DEBUG', 'OllamaClient', `Trailing pull buffer was not complete JSON: ${errorMessage(err)}`)
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
        },
      )

      this.activePullReq = req

      req.on('error', (err: NodeJS.ErrnoException) => {
        this.activePullReq = null
        const errMsg = err.code === 'ECONNREFUSED' ? 'Ollama service is not running locally (http://127.0.0.1:11434).' : err.message
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
      const req = this.request(
        urlOpts,
        {
          hostname: urlOpts.hostname,
          port: urlOpts.port,
          path: urlOpts.path,
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          logger.log('INFO', 'OllamaClient', `Model delete finished for ${modelName}: HTTP ${res.statusCode}`)
          resolve({ success: res.statusCode === 200 })
        },
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
    customOptions?: OllamaGenerationOptions,
    customHost?: string,
    operationId?: string,
  ): Promise<{ success: boolean; error?: string }> {
    if (typeof prompt !== 'string') return Promise.resolve({ success: false, error: 'Invalid prompt' })
    const urlOpts = this.resolveUrl('/api/generate', customHost)

    return ollamaGenerationScheduler.schedule(
      'stream',
      (setActiveCancel) => this.generateStreamNow(model, prompt, onChunk, onDone, customOptions, urlOpts, setActiveCancel),
      operationId,
    ).promise
  }

  private generateStreamNow(
    model: string,
    prompt: string,
    onChunk: (chunk: string) => void,
    onDone: () => void,
    customOptions: OllamaGenerationOptions | undefined,
    urlOpts: OllamaUrl,
    setActiveCancel: (cancel: () => void) => void,
  ): Promise<{ success: boolean; error?: string }> {
    // An empty model is a caller that found none configured; guessing one would pull or fail on a model the user never chose.
    if (!model?.trim()) return Promise.resolve({ success: false, error: 'No model is configured for this generation. Choose one in Settings.' })
    return new Promise((resolve) => {
      const postData = JSON.stringify({
        model,
        prompt,
        stream: true,
        think: customOptions?.think === true,
        keep_alive: customOptions?.keep_alive,
        options: {
          num_ctx: customOptions?.num_ctx || 16384,
          temperature: customOptions?.temperature ?? 0.1,
          top_p: customOptions?.top_p ?? 0.9,
          repeat_penalty: customOptions?.repeat_penalty ?? 1.1,
          ...(customOptions?.num_thread ? { num_thread: customOptions.num_thread } : {}),
        },
      })
      const req = this.request(
        urlOpts,
        {
          hostname: urlOpts.hostname,
          port: urlOpts.port,
          path: urlOpts.path,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          if (res.statusCode && res.statusCode !== 200) {
            let errBody = ''
            res.on('data', (chunk) => {
              errBody += chunk.toString()
            })
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
              },
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
        },
      )

      setActiveCancel(() => req.destroy())

      req.on('error', (err: NodeJS.ErrnoException) => {
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

    return ollamaGenerationScheduler.schedule(
      'structured',
      (setActiveCancel) => this.generateStructuredNow(request, urlOpts, setActiveCancel),
      request.operationId,
    ).promise
  }

  cancelStructuredGeneration(operationId: string): boolean {
    return ollamaGenerationScheduler.cancel(operationId)
  }

  private generateStructuredNow(
    request: OllamaStructuredRequest,
    urlOpts: OllamaUrl,
    setActiveCancel: (cancel: () => void) => void,
  ): Promise<OllamaStructuredResponse> {
    const postData = JSON.stringify({
      model: request.model,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userContent },
      ],
      format: request.format,
      stream: false,
      think: typeof request.think === 'string' ? request.think : request.think === true,
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
      let settled = false
      const finish = (result: OllamaStructuredResponse) => {
        if (settled) return
        settled = true
        resolve(result)
      }
      const req = this.request(
        urlOpts,
        {
          hostname: urlOpts.hostname,
          port: urlOpts.port,
          path: urlOpts.path,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          let raw = ''
          res.on('data', (chunk) => {
            raw += chunk.toString()
          })
          res.on('end', () => {
            if (res.statusCode !== 200) {
              finish({ status: 'transport_error', content: '', error: `Ollama HTTP ${res.statusCode}: ${raw.slice(0, 200)}` })
              return
            }
            try {
              const parsed = JSON.parse(raw)
              const content = typeof parsed?.message?.content === 'string' ? parsed.message.content : ''
              const telemetry = {
                ...(typeof parsed?.done_reason === 'string' ? { doneReason: parsed.done_reason } : {}),
                ...(typeof parsed?.prompt_eval_count === 'number' ? { promptEvalCount: parsed.prompt_eval_count } : {}),
                ...(typeof parsed?.eval_count === 'number' ? { evalCount: parsed.eval_count } : {}),
                ...(typeof parsed?.message?.thinking === 'string' ? { thinkingChars: parsed.message.thinking.length } : {}),
              }
              if (parsed?.done !== true || parsed?.done_reason === 'length') {
                const metrics = [
                  telemetry.promptEvalCount !== undefined ? `prompt_tokens=${telemetry.promptEvalCount}` : '',
                  telemetry.evalCount !== undefined ? `output_tokens=${telemetry.evalCount}` : '',
                  telemetry.thinkingChars !== undefined ? `thinking_chars=${telemetry.thinkingChars}` : '',
                ]
                  .filter(Boolean)
                  .join(', ')
                finish({
                  status: 'incomplete',
                  content,
                  error: `Ollama response incomplete${telemetry.doneReason ? ` (${telemetry.doneReason}${metrics ? `; ${metrics}` : ''})` : ''}`,
                  ...telemetry,
                })
                return
              }
              finish({ status: 'complete', content, ...telemetry })
            } catch (err: unknown) {
              finish({ status: 'transport_error', content: '', error: `Invalid Ollama response: ${errorMessage(err)}` })
            }
          })
        },
      )

      setActiveCancel(() => req.destroy())
      req.on('error', (err: NodeJS.ErrnoException) => {
        const message = err.code === 'ECONNREFUSED' ? 'Ollama service is not running locally (http://127.0.0.1:11434).' : err.message
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
}

export const ollamaHttpClient = new OllamaHttpClient()
