import { logger } from '../logging/logger'
import type { OllamaRuntimeOptions } from '../../domain/agent/hardwareProfileResolver'
import type { OllamaToolSchema } from '../../domain/agent/ollamaToolSchemaCatalog'
import type { ObservedToolCallingProtocol } from '../../../../shared/domain/agent/ollamaToolCallingCapability'
import { consumeNdjsonChunk } from './ndjsonStreamParser'
import { ollamaGenerationScheduler } from './ollamaGenerationScheduler'
import { resolveOllamaUrl, requestOllama } from './ollamaTransport'
import { normalizeOllamaHost } from '../../../../shared/domain/ollamaHost'
import type { OllamaStreamTelemetry } from '../../domain/agent/ollamaSessionRuntime'
import type { OllamaThinkValue } from '../../../../shared/types'
import { pickSamplingOverrides } from '../../../../shared/domain/agent/ollamaSamplingOptions'

export interface StreamSession {
  targetModel: string
  prompt: string
  runtimeOpts: OllamaRuntimeOptions
  keepAlive?: string
  ollamaEndpoint?: string
  onTokenChunk?: (chunk: string) => void
  onThoughtChunk?: (chunk: string) => void
  /** Effective `think` value (switch or level). Undefined omits the field, so the model's own default applies. */
  think?: OllamaThinkValue
  isCancelled: () => boolean
  signal?: AbortSignal
  onCancelHandle?: (abort: () => void) => void
  /** When true (and toolCatalog is non-empty), routes through POST /api/chat with a `tools` array instead of the prompt-engineered POST /api/generate path (see ollamaToolCallingCapability.ts). */
  toolCallingCapable?: boolean
  toolCatalog?: OllamaToolSchema[]
  /** Native chat transcript. When supplied, the structured assistant turn is returned. */
  messages?: AgentChatMessage[]
  /** Ollama `context` token array from a previous /api/generate response on the SAME model, to continue from instead of re-evaluating the full prompt (see ollamaContextCacheManager.ts / AGT1). */
  previousContext?: number[]
  /** Invoked with the `context` array from the final NDJSON line of a completed /api/generate response (present when `done: true`), and the model that produced it. */
  onContextReceived?: (context: number[], respondingModel: string) => void
  onToolProtocolObserved?: (protocol: ObservedToolCallingProtocol) => void
  onGenerationTelemetry?: (telemetry: OllamaStreamTelemetry) => void
  /** Silence tolerated on the native chat stream before it is treated as stalled (default 5 min). */
  stallTimeoutMs?: number
}

/** Default silence limit before a chat stream counts as stalled. */
export const DEFAULT_STREAM_STALL_MS = 300000

export interface AgentChatToolCall {
  type: 'function'
  function: { index: number; name: string; arguments: Record<string, unknown> }
}

export interface AgentChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  thinking?: string
  tool_calls?: AgentChatToolCall[]
  tool_name?: string
}

export interface AgentChatTurn {
  content: string
  thinking: string
  toolCalls: AgentChatToolCall[]
}

/**
 * The `options` object for an agent request: the context window, the output cap and only the sampling
 * keys the user overrode. No stop sequences: native tool calling needs none, and Qwen documents
 * stopword templates as unsafe for reasoning models.
 */
export function ollamaRequestOptions(runtimeOpts: OllamaRuntimeOptions): Record<string, number> {
  return {
    num_ctx: runtimeOpts.num_ctx,
    ...pickSamplingOverrides(runtimeOpts),
    ...(runtimeOpts.num_predict ? { num_predict: runtimeOpts.num_predict } : {}),
  }
}

function thinkField(think: OllamaThinkValue | undefined): { think?: OllamaThinkValue } {
  return think === undefined ? {} : { think }
}

function durationMs(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value / 1_000_000) : undefined
}

function streamTelemetry(parsed: Record<string, unknown>, model: string, numCtx: number, startedAt: number): OllamaStreamTelemetry {
  return {
    model,
    numCtx,
    startedAt: new Date(startedAt).toISOString(),
    wallDurationMs: Date.now() - startedAt,
    totalDurationMs: durationMs(parsed.total_duration),
    loadDurationMs: durationMs(parsed.load_duration),
    promptEvalDurationMs: durationMs(parsed.prompt_eval_duration),
    evalDurationMs: durationMs(parsed.eval_duration),
    promptTokens: typeof parsed.prompt_eval_count === 'number' ? parsed.prompt_eval_count : undefined,
    completionTokens: typeof parsed.eval_count === 'number' ? parsed.eval_count : undefined,
  }
}

/** Serializes a native tool_calls[0] entry into the same {"name", "arguments"} JSON text shape toolParser.ts already knows how to parse (see extractToolCallFromText's rawToolName / "arguments" handling), so a native tool-calling response and a prompt-engineered o */
function serializeNativeToolCall(name: string, args: Record<string, unknown>): string {
  return JSON.stringify({ name, arguments: args })
}

export class AgentStreamTransport {
  static streamCompletion(session: StreamSession & { messages: AgentChatMessage[] }): Promise<AgentChatTurn>
  static streamCompletion(session: StreamSession & { messages?: undefined }): Promise<string>
  static streamCompletion(session: StreamSession): Promise<string | AgentChatTurn> {
    if (session.signal?.aborted || session.isCancelled()) {
      return Promise.reject(new Error('Agent run cancelled.'))
    }
    const scheduled = ollamaGenerationScheduler.schedule('agent', (setActiveCancel) =>
      this.streamCompletionNow({ ...session, onCancelHandle: setActiveCancel }),
    )
    session.onCancelHandle?.(scheduled.cancel)
    return scheduled.promise
  }

  private static async streamCompletionNow(session: StreamSession): Promise<string | AgentChatTurn> {
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
      onThoughtChunk,
      isCancelled,
      signal,
      onCancelHandle,
      previousContext,
      onContextReceived,
      onGenerationTelemetry,
    } = session

    // Honors https:// hosts like every other Ollama call (this path used to force plain http).
    const ollamaUrl = resolveOllamaUrl('/api/generate', ollamaEndpoint)

    return new Promise<string>((resolve, reject) => {
      const postData = JSON.stringify({
        model: targetModel,
        prompt,
        stream: true,
        ...thinkField(session.think),
        keep_alive: keepAlive || '30m',
        ...(previousContext && previousContext.length > 0 ? { context: previousContext } : {}),
        options: ollamaRequestOptions(runtimeOpts),
      })

      let responseTimer: NodeJS.Timeout | null = setTimeout(() => {
        req.destroy(new Error(`Ollama initial response timeout (45s): model '${targetModel}' loading stalled.`))
      }, 45000)

      let tokenStallTimer: NodeJS.Timeout | null = null
      const requestStartedAt = Date.now()

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

      const req = requestOllama(
        ollamaUrl,
        {
          method: 'POST',
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
          let sawDone = false
          let doneReason: string | undefined
          let completedTelemetry: OllamaStreamTelemetry | undefined

          res.on('data', (chunk) => {
            if (isCancelled()) {
              cleanupTimers()
              req.destroy()
              resolve(fullText)
              return
            }
            resetTokenStallTimer()
            buffer = consumeNdjsonChunk(
              buffer,
              chunk,
              (parsed) => {
                const thinkingDelta = parsed.thinking ?? parsed.message?.thinking
                if (thinkingDelta && onThoughtChunk) {
                  onThoughtChunk(thinkingDelta)
                }
                if (parsed.response) {
                  fullText += parsed.response
                  if (onTokenChunk) {
                    onTokenChunk(parsed.response)
                  }
                }
                if (parsed.done && Array.isArray(parsed.context) && onContextReceived) {
                  onContextReceived(parsed.context, targetModel)
                }
                if (parsed.done === true) {
                  sawDone = true
                  doneReason = parsed.done_reason
                  completedTelemetry = streamTelemetry(parsed, targetModel, runtimeOpts.num_ctx, requestStartedAt)
                }
              },
              (jsonErr) => {
                logger.log('WARN', 'AgentStreamTransport', `Partial stream JSON parse skipped: ${jsonErr.message}`)
              },
            )
          })

          res.on('end', () => {
            cleanupTimers()
            if (!isCancelled() && (!sawDone || doneReason === 'length')) {
              reject(new Error(`Ollama response incomplete${doneReason ? ` (${doneReason})` : ''}`))
              return
            }
            if (completedTelemetry) onGenerationTelemetry?.(completedTelemetry)
            resolve(fullText)
          })
        },
      )

      req.on('error', (err: NodeJS.ErrnoException) => {
        cleanupTimers()
        if (err.code === 'ECONNREFUSED') {
          reject(new Error(`Ollama service is not reachable at ${normalizeOllamaHost(ollamaEndpoint)}. Please ensure Ollama is running.`))
        } else {
          reject(err)
        }
      })

      const abortRequest = () => req.destroy(new Error('Agent run cancelled.'))
      if (onCancelHandle) onCancelHandle(abortRequest)
      signal?.addEventListener('abort', abortRequest, { once: true })
      req.on('close', () => signal?.removeEventListener('abort', abortRequest))

      req.write(postData)
      req.end()
    })
  }

  /** Native tool-calling path: POST /api/chat with a `tools` array, streamed (stream:true) and parsed incrementally like streamCompletion's /api/generate path (AGT7) — Ollama's tool_calls field only arrives on the final NDJSON line (done:true), but message.content */
  private static async streamChatWithTools(session: StreamSession): Promise<string | AgentChatTurn> {
    const { targetModel, prompt, runtimeOpts, keepAlive, ollamaEndpoint, onTokenChunk, onThoughtChunk, isCancelled, signal, onCancelHandle, toolCatalog } =
      session

    const chatUrl = resolveOllamaUrl('/api/chat', ollamaEndpoint)

    return new Promise<string | AgentChatTurn>((resolve, reject) => {
      const postData = JSON.stringify({
        model: targetModel,
        messages: session.messages ?? [{ role: 'user', content: prompt }],
        tools: toolCatalog,
        stream: true,
        ...thinkField(session.think),
        keep_alive: keepAlive || '30m',
        options: ollamaRequestOptions(runtimeOpts),
      })

      let responseTimer: NodeJS.Timeout | null = setTimeout(() => {
        req.destroy(new Error(`Ollama chat initial response timeout (10m): model '${targetModel}' loading stalled.`))
      }, 600000)

      let tokenStallTimer: NodeJS.Timeout | null = null
      const requestStartedAt = Date.now()
      const resetTokenStallTimer = () => {
        if (tokenStallTimer) clearTimeout(tokenStallTimer)
        const stallMs = session.stallTimeoutMs ?? DEFAULT_STREAM_STALL_MS
        tokenStallTimer = setTimeout(() => {
          req.destroy(new Error(`Ollama chat stream stalled: no progress received for ${Math.round(stallMs / 60000)}m from model '${targetModel}'.`))
        }, stallMs)
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

      const req = requestOllama(
        chatUrl,
        {
          method: 'POST',
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
          let fullThinking = ''
          const toolCalls: Array<{ index?: number; name: string; arguments: Record<string, unknown> | string }> = []
          let sawDone = false
          let doneReason: string | undefined
          let completedTelemetry: OllamaStreamTelemetry | undefined

          res.on('data', (chunk) => {
            if (isCancelled()) {
              cleanupTimers()
              req.destroy()
              resolve(fullText)
              return
            }
            resetTokenStallTimer()
            buffer = consumeNdjsonChunk(
              buffer,
              chunk,
              (parsed) => {
                const thinkingDelta = parsed?.message?.thinking ?? parsed?.thinking
                if (thinkingDelta && onThoughtChunk) {
                  onThoughtChunk(thinkingDelta)
                }
                if (thinkingDelta) fullThinking += thinkingDelta
                const contentDelta = parsed?.message?.content
                if (contentDelta) {
                  fullText += contentDelta
                  if (onTokenChunk) onTokenChunk(contentDelta)
                }
                const receivedCalls = parsed?.message?.tool_calls
                if (Array.isArray(receivedCalls)) {
                  for (let position = 0; position < receivedCalls.length; position++) {
                    const call = receivedCalls[position]
                    if (!call?.function) continue
                    const index = typeof call.function.index === 'number' ? call.function.index : undefined
                    const previous = index === undefined ? undefined : toolCalls.find((item) => item.index === index)
                    const name = call.function.name || previous?.name
                    if (!name) continue
                    const args = call.function.arguments
                    const accumulatedArgs =
                      typeof args === 'string' && typeof previous?.arguments === 'string' ? previous.arguments + args : (args ?? previous?.arguments ?? {})
                    if (previous) {
                      previous.name = name
                      previous.arguments = accumulatedArgs
                    } else {
                      toolCalls.push({ index, name, arguments: accumulatedArgs })
                    }
                  }
                }
                if (parsed?.done === true) {
                  sawDone = true
                  doneReason = parsed.done_reason
                  completedTelemetry = streamTelemetry(parsed, targetModel, runtimeOpts.num_ctx, requestStartedAt)
                }
              },
              (jsonErr) => {
                logger.log('WARN', 'AgentStreamTransport', `Partial chat stream JSON parse skipped: ${jsonErr.message}`)
              },
            )
          })

          res.on('end', () => {
            cleanupTimers()
            if (!isCancelled() && (!sawDone || doneReason === 'length')) {
              reject(new Error(`Ollama tool response incomplete${doneReason ? ` (${doneReason})` : ''}`))
              return
            }
            let structuredCalls: AgentChatToolCall[]
            try {
              structuredCalls = toolCalls
                .sort((left, right) => (left.index ?? Number.MAX_SAFE_INTEGER) - (right.index ?? Number.MAX_SAFE_INTEGER))
                .map((call, index) => {
                  const args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments
                  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error(`Invalid arguments for ${call.name}`)
                  return { type: 'function', function: { index, name: call.name, arguments: args } }
                })
            } catch (error: unknown) {
              reject(new Error(`Invalid Ollama tool arguments: ${error instanceof Error ? error.message : String(error)}`))
              return
            }
            const first = structuredCalls[0]
            if (first) resolvedToolCall = serializeNativeToolCall(first.function.name, first.function.arguments)
            if (completedTelemetry) session.onGenerationTelemetry?.(completedTelemetry)
            session.onToolProtocolObserved?.(resolvedToolCall ? 'native' : 'text')
            resolve(session.messages ? { content: fullText, thinking: fullThinking, toolCalls: structuredCalls } : (resolvedToolCall ?? fullText))
          })
        },
      )

      req.on('error', (err: NodeJS.ErrnoException) => {
        cleanupTimers()
        if (err.code === 'ECONNREFUSED') {
          reject(new Error(`Ollama service is not reachable at ${normalizeOllamaHost(ollamaEndpoint)}. Please ensure Ollama is running.`))
        } else {
          reject(err)
        }
      })

      const abortRequest = () => req.destroy(new Error('Agent run cancelled.'))
      if (onCancelHandle) onCancelHandle(abortRequest)
      signal?.addEventListener('abort', abortRequest, { once: true })
      req.on('close', () => signal?.removeEventListener('abort', abortRequest))

      req.write(postData)
      req.end()
    })
  }
}
