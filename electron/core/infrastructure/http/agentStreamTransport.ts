import http from 'node:http'
import { logger } from '../../../diagnostics'
import type { OllamaRuntimeOptions } from '../../domain/agent/hardwareProfileResolver'

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 })

export interface StreamSession {
  targetModel: string
  prompt: string
  runtimeOpts: OllamaRuntimeOptions
  ollamaEndpoint?: string
  onTokenChunk?: (chunk: string) => void
  isCancelled: () => boolean
  onHttpRequestCreated?: (req: http.ClientRequest) => void
}

export class AgentStreamTransport {
  static async streamCompletion(session: StreamSession): Promise<string> {
    const {
      targetModel,
      prompt,
      runtimeOpts,
      ollamaEndpoint,
      onTokenChunk,
      isCancelled,
      onHttpRequestCreated,
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
            options: {
              num_ctx: runtimeOpts.num_ctx,
              temperature: runtimeOpts.temperature,
              top_p: runtimeOpts.top_p,
              repeat_penalty: runtimeOpts.repeat_penalty,
              ...(runtimeOpts.num_thread ? { num_thread: runtimeOpts.num_thread } : {}),
            },
          })

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
              if (res.statusCode && res.statusCode !== 200) {
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

              let buffer = ''
              let fullText = ''

              res.on('data', (chunk) => {
                if (isCancelled()) {
                  req.destroy()
                  resolve(fullText)
                  return
                }
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
                    } catch (jsonErr: any) {
                      logger.log('WARN', 'AgentStreamTransport', `Partial stream JSON parse skipped: ${jsonErr.message}`)
                    }
                  }
                }
              })

              res.on('end', () => resolve(fullText))
            }
          )

          req.on('error', (err: any) => {
            if (err.code === 'ECONNREFUSED') {
              reject(new Error(`Ollama service is not reachable at ${hostStr}. Please ensure Ollama is running.`))
            } else {
              reject(err)
            }
          })

          req.setTimeout(300000, () => {
            req.destroy()
            reject(new Error('LLM request timed out (300s)'))
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
}
