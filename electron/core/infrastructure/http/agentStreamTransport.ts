import http from 'node:http'
import { logger } from '../../../diagnostics'
import type { OllamaRuntimeOptions } from '../../domain/agent/hardwareProfileResolver'
import type { OllamaToolSchema } from '../../domain/agent/ollamaToolSchemaCatalog'

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 })

export interface StreamSession {
  targetModel: string
  prompt: string
  runtimeOpts: OllamaRuntimeOptions
  keepAlive?: string
  ollamaEndpoint?: string
  onTokenChunk?: (chunk: string) => void
  isCancelled: () => boolean
  onHttpRequestCreated?: (req: http.ClientRequest) => void
  /**
   * When true (and toolCatalog is non-empty), routes through POST /api/chat
   * with a `tools` array instead of the prompt-engineered POST /api/generate
   * path (see ollamaToolCallingCapability.ts). Absent/false preserves the
   * exact existing /api/generate behavior for every other caller.
   */
  toolCallingCapable?: boolean
  toolCatalog?: OllamaToolSchema[]
  /**
   * Ollama `context` token array from a previous /api/generate response on the
   * SAME model, to continue from instead of re-evaluating the full prompt
   * (see ollamaContextCacheManager.ts / AGT1). Only meaningful for the
   * /api/generate path — ignored by streamChatWithTools.
   */
  previousContext?: number[]
  /**
   * Invoked with the `context` array from the final NDJSON line of a
   * completed /api/generate response (present when `done: true`), and the
   * model that produced it. Not invoked by streamChatWithTools.
   */
  onContextReceived?: (context: number[], respondingModel: string) => void
}

/**
 * Serializes a native tool_calls[0] entry into the same {"name", "arguments"}
 * JSON text shape toolParser.ts already knows how to parse (see
 * extractToolCallFromText's rawToolName / "arguments" handling), so a native
 * tool-calling response and a prompt-engineered one both flow through the
 * exact same downstream parsing pipeline.
 */
function serializeNativeToolCall(name: string, args: Record<string, unknown>): string {
  return JSON.stringify({ name, arguments: args })
}

export class AgentStreamTransport {
  static async streamCompletion(session: StreamSession): Promise<string> {
    if (session.toolCallingCapable && session.toolCatalog && session.toolCatalog.length > 0) {
      return this.streamChatWithTools(session)
    }

    const {
      targetModel,
      prompt,
      runtimeOpts,
      keepAlive,
      ollamaEndpoint,
      onTokenChunk,
      isCancelled,
      onHttpRequestCreated,
      previousContext,
      onContextReceived,
    } = session

    const hostStr = ollamaEndpoint?.trim() || 'http://127.0.0.1:11434'
    let ollamaUrl: URL
    try {
      ollamaUrl = new URL('/api/generate', hostStr.startsWith('http') ? hostStr : `http://${hostStr}`)
    } catch {
      ollamaUrl = new URL('http://127.0.0.1:11434/api/generate')
    }

    let streamedOutput = ''
    let attempts = 0
    const maxAttempts = 2

    while (attempts < maxAttempts) {
      attempts++
      try {
        streamedOutput = await new Promise<string>((resolve, reject) => {
          const postData = JSON.stringify({
            model: targetModel,
            prompt,
            stream: true,
            keep_alive: keepAlive || '30m',
            ...(previousContext && previousContext.length > 0 ? { context: previousContext } : {}),
            options: {
              num_ctx: runtimeOpts.num_ctx,
              temperature: runtimeOpts.temperature,
              top_p: runtimeOpts.top_p,
              repeat_penalty: runtimeOpts.repeat_penalty,
              ...(runtimeOpts.num_thread ? { num_thread: runtimeOpts.num_thread } : {}),
            },
          })

          let responseTimer: NodeJS.Timeout | null = setTimeout(() => {
            req.destroy(new Error(`Ollama initial response timeout (45s): model '${targetModel}' loading stalled.`))
          }, 45000)

          let tokenStallTimer: NodeJS.Timeout | null = null

          const resetTokenStallTimer = () => {
            if (tokenStallTimer) clearTimeout(tokenStallTimer)
            tokenStallTimer = setTimeout(() => {
              req.destroy(new Error(`Ollama stream stalled: no tokens received for 30s from model '${targetModel}'.`))
            }, 30000)
          }

          const cleanupTimers = () => {
            if (responseTimer) {
              clearTimeout(responseTimer)
              responseTimer = null
            }
            if (tokenStallTimer) {
              clearTimeout(tokenStallTimer)
              tokenStallTimer = null
            }
          }

          const req = http.request(
            {
              hostname: ollamaUrl.hostname,
              port: ollamaUrl.port || 11434,
              path: ollamaUrl.pathname,
              method: 'POST',
              agent: httpAgent,
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
              },
            },
            (res) => {
              if (responseTimer) {
                clearTimeout(responseTimer)
                responseTimer = null
              }

              if (res.statusCode && res.statusCode !== 200) {
                cleanupTimers()
                let errBody = ''
                res.on('data', (chunk) => {
                  errBody += chunk.toString()
                })
                res.on('end', () => {
                  const msg =
                    res.statusCode === 404
                      ? `Model '${targetModel}' is not pulled in Ollama. Please run 'ollama pull ${targetModel}'.`
                      : `Ollama HTTP Error ${res.statusCode}: ${errBody.slice(0, 300)}`
                  reject(new Error(msg))
                })
                return
              }

              resetTokenStallTimer()

              let buffer = ''
              let fullText = ''

              res.on('data', (chunk) => {
                if (isCancelled()) {
                  cleanupTimers()
                  req.destroy()
                  resolve(fullText)
                  return
                }
                resetTokenStallTimer()
                buffer += chunk.toString()
                const lines = buffer.split('\n')
                buffer = lines.pop() || ''
                for (const line of lines) {
                  if (line.trim()) {
                    try {
                      const parsed = JSON.parse(line)
                      if (parsed.response) {
                        fullText += parsed.response
                        if (onTokenChunk) {
                          onTokenChunk(parsed.response)
                        }
                      }
                      if (parsed.done && Array.isArray(parsed.context) && onContextReceived) {
                        onContextReceived(parsed.context, targetModel)
                      }
                    } catch (jsonErr: any) {
                      logger.log('WARN', 'AgentStreamTransport', `Partial stream JSON parse skipped: ${jsonErr.message}`)
                    }
                  }
                }
              })

              res.on('end', () => {
                cleanupTimers()
                resolve(fullText)
              })
            }
          )

          req.on('error', (err: any) => {
            cleanupTimers()
            if (err.code === 'ECONNREFUSED') {
              reject(new Error(`Ollama service is not reachable at ${hostStr}. Please ensure Ollama is running.`))
            } else {
              reject(err)
            }
          })

          if (onHttpRequestCreated) {
            onHttpRequestCreated(req)
          }

          req.write(postData)
          req.end()
        })
        break
      } catch (err: any) {
        const isFatal =
          err.message.includes('not pulled') ||
          err.message.includes('not reachable') ||
          err.message.includes('not running')

        if (attempts < maxAttempts && !isFatal) {
          logger.log('INFO', 'AgentStreamTransport', `Ollama request attempt ${attempts} failed (${err.message}). Retrying in 1s...`)
          await new Promise((r) => setTimeout(r, 1000))
        } else {
          throw err
        }
      }
    }

    return streamedOutput
  }

  /**
   * Native tool-calling path: POST /api/chat with a `tools` array, streamed
   * (stream:true) and parsed incrementally like streamCompletion's /api/generate
   * path (AGT7) — Ollama's tool_calls field only arrives on the final NDJSON
   * line (done:true), but message.content deltas arrive incrementally on every
   * line same as the prompt-engineered path, so onTokenChunk now fires live
   * here too instead of the UI going silent until the whole response lands.
   *
   * Returns the SAME string contract as streamCompletion: either the
   * serialized {"name","arguments"} tool call (when message.tool_calls is
   * populated) or the model's raw text content (when it isn't — some
   * "tools"-capable models, e.g. the qwen family, echo the call as JSON
   * text in `content` instead of populating tool_calls). Either shape is
   * parsed identically downstream by toolParser.ts.
   */
  private static async streamChatWithTools(session: StreamSession): Promise<string> {
    const { targetModel, prompt, runtimeOpts, keepAlive, ollamaEndpoint, onTokenChunk, isCancelled, onHttpRequestCreated, toolCatalog } = session

    const hostStr = ollamaEndpoint?.trim() || 'http://127.0.0.1:11434'
    let chatUrl: URL
    try {
      chatUrl = new URL('/api/chat', hostStr.startsWith('http') ? hostStr : `http://${hostStr}`)
    } catch {
      chatUrl = new URL('http://127.0.0.1:11434/api/chat')
    }

    return new Promise<string>((resolve, reject) => {
      const postData = JSON.stringify({
        model: targetModel,
        messages: [{ role: 'user', content: prompt }],
        tools: toolCatalog,
        stream: true,
        keep_alive: keepAlive || '30m',
        options: {
          num_ctx: runtimeOpts.num_ctx,
          temperature: runtimeOpts.temperature,
          top_p: runtimeOpts.top_p,
          repeat_penalty: runtimeOpts.repeat_penalty,
          ...(runtimeOpts.num_thread ? { num_thread: runtimeOpts.num_thread } : {}),
        },
      })

      let responseTimer: NodeJS.Timeout | null = setTimeout(() => {
        req.destroy(new Error(`Ollama chat initial response timeout (45s): model '${targetModel}' loading stalled.`))
      }, 45000)

      let tokenStallTimer: NodeJS.Timeout | null = null
      const resetTokenStallTimer = () => {
        if (tokenStallTimer) clearTimeout(tokenStallTimer)
        tokenStallTimer = setTimeout(() => {
          req.destroy(new Error(`Ollama chat stream stalled: no tokens received for 30s from model '${targetModel}'.`))
        }, 30000)
      }
      const cleanupTimers = () => {
        if (responseTimer) {
          clearTimeout(responseTimer)
          responseTimer = null
        }
        if (tokenStallTimer) {
          clearTimeout(tokenStallTimer)
          tokenStallTimer = null
        }
      }

      const req = http.request(
        {
          hostname: chatUrl.hostname,
          port: chatUrl.port || 11434,
          path: chatUrl.pathname,
          method: 'POST',
          agent: httpAgent,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          if (responseTimer) {
            clearTimeout(responseTimer)
            responseTimer = null
          }

          if (res.statusCode && res.statusCode !== 200) {
            cleanupTimers()
            let errBody = ''
            res.on('data', (chunk) => {
              errBody += chunk.toString()
            })
            res.on('end', () => {
              const msg =
                res.statusCode === 404
                  ? `Model '${targetModel}' is not pulled in Ollama. Please run 'ollama pull ${targetModel}'.`
                  : `Ollama HTTP Error ${res.statusCode}: ${errBody.slice(0, 300)}`
              reject(new Error(msg))
            })
            return
          }

          resetTokenStallTimer()

          let buffer = ''
          let fullText = ''
          let resolvedToolCall: string | null = null

          res.on('data', (chunk) => {
            if (isCancelled()) {
              cleanupTimers()
              req.destroy()
              resolve(fullText)
              return
            }
            resetTokenStallTimer()
            buffer += chunk.toString()
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''
            for (const line of lines) {
              if (!line.trim()) continue
              try {
                const parsed = JSON.parse(line)
                const contentDelta = parsed?.message?.content
                if (contentDelta) {
                  fullText += contentDelta
                  if (onTokenChunk) onTokenChunk(contentDelta)
                }
                const toolCalls = parsed?.message?.tool_calls
                if (Array.isArray(toolCalls) && toolCalls.length > 0 && toolCalls[0]?.function?.name) {
                  resolvedToolCall = serializeNativeToolCall(toolCalls[0].function.name, toolCalls[0].function.arguments || {})
                }
              } catch (jsonErr: any) {
                logger.log('WARN', 'AgentStreamTransport', `Partial chat stream JSON parse skipped: ${jsonErr.message}`)
              }
            }
          })

          res.on('end', () => {
            cleanupTimers()
            resolve(resolvedToolCall ?? fullText)
          })
        }
      )

      req.on('error', (err: any) => {
        cleanupTimers()
        if (err.code === 'ECONNREFUSED') {
          reject(new Error(`Ollama service is not reachable at ${hostStr}. Please ensure Ollama is running.`))
        } else {
          reject(err)
        }
      })

      if (onHttpRequestCreated) {
        onHttpRequestCreated(req)
      }

      req.write(postData)
      req.end()
    })
  }
}
