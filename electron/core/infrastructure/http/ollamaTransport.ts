import http from 'node:http'
import https from 'node:https'
import { DEFAULT_OLLAMA_HOST, normalizeOllamaHost } from '../../../../shared/domain/ollamaHost'

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 })
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 })

export type OllamaUrl = { protocol: 'http:' | 'https:'; hostname: string; port: number | string; path: string }

/** Resolves an Ollama API path against a configured host; unparsable hosts fall back to the local default. */
export function resolveOllamaUrl(apiPath: string, host?: string): OllamaUrl {
  try {
    const u = new URL(apiPath, normalizeOllamaHost(host))
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Unsupported protocol')
    return { protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 11434), path: u.pathname }
  } catch {
    const fallback = new URL(DEFAULT_OLLAMA_HOST)
    return { protocol: 'http:', hostname: fallback.hostname, port: fallback.port, path: apiPath }
  }
}

/** Issues a request over http or https, matching the configured host, with a shared keep-alive agent. */
export function requestOllama(url: OllamaUrl, options: http.RequestOptions, listener: (response: http.IncomingMessage) => void): http.ClientRequest {
  const secure = url.protocol === 'https:'
  const transport = secure ? https : http
  return transport.request({ hostname: url.hostname, port: url.port, path: url.path, ...options, agent: secure ? httpsAgent : httpAgent }, listener)
}
