import fs from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import http from 'node:http'
import { decodeSettingsFile } from '../../electron/core/domain/settings/settingsFile'
import type { AppSettings } from '../../shared/types'

export type SmokeRole = 'chat' | 'coding' | 'translation' | 'embedding' | 'vision'
const fields = { chat: 'chatModel', coding: 'codingModel', translation: 'translationModel', embedding: 'embeddingModel', vision: 'visionModel' } as const
const LIMITS = { generation: 4, embedding: 16, milliseconds: 300_000 } as const

/** Exclusive reservations survive restarts; even a failed dispatch consumes its slot. */
export class SmokeBudget {
  private releaseLock: () => void
  readonly expiresAt: number

  constructor(
    private directory: string,
    private now: () => number = Date.now,
  ) {
    if (!path.isAbsolute(directory)) throw new Error('Use an absolute shared work-session directory')
    fs.mkdirSync(directory, { recursive: true })
    if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Session directory must not be a link')
    const lock = path.join(directory, 'smoke.lock')
    const handle = fs.openSync(lock, 'wx')
    this.releaseLock = () => {
      fs.closeSync(handle)
      fs.unlinkSync(lock)
    }
    try {
      fs.writeFileSync(handle, JSON.stringify({ pid: process.pid }), { flush: true })
      const ownerPath = path.join(directory, 'smoke-budget.json')
      if (!fs.existsSync(ownerPath)) {
        if (fs.readdirSync(directory).some((name) => /^(generation|embedding)-\d+\.json$/.test(name))) {
          throw new Error('Existing reservations have no session budget; automatic reset refused')
        }
        fs.writeFileSync(ownerPath, JSON.stringify({ startedAt: now(), limits: LIMITS }), { flag: 'wx', flush: true })
      }
      const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'))
      if (!Number.isFinite(owner.startedAt) || owner.startedAt > now() || JSON.stringify(owner.limits) !== JSON.stringify(LIMITS)) {
        throw new Error('Invalid shared session budget; counters cannot be reset')
      }
      this.expiresAt = owner.startedAt + LIMITS.milliseconds
    } catch (error) {
      this.releaseLock()
      throw error
    }
  }

  remaining(): number {
    const remaining = this.expiresAt - this.now()
    if (remaining <= 0) throw new Error('Shared five-minute smoke budget exhausted')
    return remaining
  }

  reserve(kind: 'generation' | 'embedding', role: SmokeRole, model: string): void {
    this.remaining()
    for (let index = 1; index <= LIMITS[kind]; index++) {
      try {
        fs.writeFileSync(path.join(this.directory, `${kind}-${index}.json`), JSON.stringify({ role, model, at: this.now() }), { flag: 'wx', flush: true })
        return
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    throw new Error(`Shared ${kind} request budget exhausted`)
  }

  close(): void {
    this.releaseLock()
  }
}

export function configuredSmokeSettings(settingsFile: string, roles: readonly SmokeRole[]) {
  const raw = fs.readFileSync(settingsFile)
  const envelope = JSON.parse(raw.toString('utf8'))
  const settings = decodeSettingsFile(envelope)
  if (!roles.length || new Set(roles).size !== roles.length || roles.some((role) => !Object.hasOwn(fields, role)))
    throw new Error('Choose distinct chat, coding, translation, vision or embedding roles')
  // The app decoder supplies application defaults; a smoke must require actual saved assignments.
  if (typeof envelope.settings.ollamaHost !== 'string' || !envelope.settings.ollamaHost.trim()) throw new Error('No Ollama host configured in the app')
  const host = new URL(settings.ollamaHost)
  if (
    !['http:', 'https:'].includes(host.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname) ||
    host.username ||
    host.password ||
    host.search ||
    host.hash
  ) {
    throw new Error('Smoke tests require a configured local Ollama endpoint without credentials')
  }
  const models = roles.map((role) => {
    const saved = envelope.settings[fields[role]]
    const model = typeof saved === 'string' ? saved.trim() : ''
    if (!model) throw new Error(`No ${role} model configured in the app`)
    return { role, model }
  })
  return { settings, models, host, digest: createHash('sha256').update(raw).digest('hex') }
}

function generationBody(settings: AppSettings, role: SmokeRole, model: string) {
  const context = settings.modelContextLengths?.[model]
  const thinking = settings.modelThinkingPreferences?.[model]
  return {
    model,
    stream: false,
    messages: [
      {
        role: 'user',
        content:
          role === 'translation'
            ? 'Translate into English: Il file è pronto.'
            : role === 'coding'
              ? 'Return one JavaScript expression that adds 2 and 3.'
              : 'Reply with a short greeting.',
      },
    ],
    options: { ...settings.modelSamplingOverrides?.[model], ...(context ? { num_ctx: context } : {}) },
    ...(thinking === undefined ? {} : { think: thinking }),
  }
}

export async function runConfiguredModelSmoke(args: { sessionDirectory: string; settingsFile: string; roles: SmokeRole[] }, fetcher: typeof fetch = fetch) {
  if (args.roles.includes('vision')) throw new Error('Vision requires an image workload; use the bounded desktop proxy')
  const config = configuredSmokeSettings(args.settingsFile, args.roles)
  if (!path.isAbsolute(args.sessionDirectory)) throw new Error('Use an absolute shared work-session directory')
  const session = args.sessionDirectory
  const relative = path.relative(session, path.resolve(args.settingsFile))
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) throw new Error('Session must be isolated from the source settings')
  const budget = new SmokeBudget(session)
  const runDirectory = path.join(session, `run-${randomUUID()}`)
  const sourceDigest = () => createHash('sha256').update(fs.readFileSync(args.settingsFile)).digest('hex')
  const results: Array<{ role: SmokeRole; model: string; response: unknown }> = []
  let failure: unknown
  try {
    fs.mkdirSync(runDirectory)
    fs.mkdirSync(path.join(runDirectory, 'workspace'))
    fs.writeFileSync(
      path.join(runDirectory, 'settings.json'),
      JSON.stringify({
        version: 2,
        settings: {
          ...config.settings,
          customWorkspacePath: path.join(runDirectory, 'workspace'),
          translationOutputFolder: path.join(runDirectory, 'output'),
          autoInstallHubSkills: 'disabled',
        },
      }),
      { flag: 'wx', flush: true },
    )
    const request = async (endpoint: string, body?: unknown) => {
      const response = await fetcher(new URL(endpoint, config.host), {
        method: body ? 'POST' : 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(budget.remaining()),
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      })
      if (!response.ok) throw new Error(`Ollama request failed: ${response.status}`)
      const value: unknown = await response.json()
      budget.remaining()
      return value
    }
    const tags = (await request('/api/tags')) as { models?: Array<{ name: string }> }
    for (const { role, model } of config.models) {
      if (!tags.models?.some((entry) => entry.name === model || entry.name === `${model}:latest`))
        throw new Error(`Configured ${role} model is not installed: ${model}`)
    }
    for (const { role, model } of config.models) {
      budget.reserve(role === 'embedding' ? 'embedding' : 'generation', role, model)
      const body = role === 'embedding' ? { model, input: ['Synthetic local smoke document.'] } : generationBody(config.settings, role, model)
      fs.writeFileSync(path.join(runDirectory, `${role}-request.json`), JSON.stringify(body), { flag: 'wx', flush: true })
      const response = await request(role === 'embedding' ? '/api/embed' : '/api/chat', body)
      fs.writeFileSync(path.join(runDirectory, `${role}-response.json`), JSON.stringify(response), { flag: 'wx', flush: true })
      if (role === 'embedding') {
        const vectors = (response as { embeddings?: unknown }).embeddings
        if (
          !Array.isArray(vectors) ||
          vectors.length !== 1 ||
          !Array.isArray(vectors[0]) ||
          !vectors[0].length ||
          !vectors[0].every((v: unknown) => typeof v === 'number' && Number.isFinite(v))
        )
          throw new Error('Invalid embedding response')
      } else {
        const value = response as { done?: boolean; message?: { content?: unknown } }
        if (value.done !== true || typeof value.message?.content !== 'string' || !value.message.content.trim())
          throw new Error('Incomplete generation response')
      }
      results.push({ role, model, response })
    }
  } catch (error) {
    failure = error
  } finally {
    try {
      const unchanged = sourceDigest() === config.digest
      if (!unchanged) failure = new Error('Source settings changed during smoke; preserve evidence and inspect', { cause: failure })
      fs.writeFileSync(
        path.join(runDirectory, 'result.json'),
        JSON.stringify({
          results,
          sourceSettingsUnchanged: unchanged,
          error: failure instanceof Error ? failure.message : failure ? String(failure) : undefined,
        }),
        { flag: 'wx', flush: true },
      )
    } finally {
      budget.close()
    }
  }
  if (failure) throw failure
  return { runDirectory, results }
}

/** Budget every model request emitted by an isolated desktop/Sidecar, including retries. */
export async function startConfiguredSmokeProxy(args: { sessionDirectory: string; settingsFile: string; roles: SmokeRole[] }) {
  const config = configuredSmokeSettings(args.settingsFile, args.roles)
  const relative = path.relative(args.sessionDirectory, path.resolve(args.settingsFile))
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) throw new Error('Session must be isolated from the source settings')
  const budget = new SmokeBudget(args.sessionDirectory)
  const readOnly = new Set(['/api/tags', '/api/version', '/api/show', '/api/ps'])
  const generation = new Set(['/api/chat', '/api/generate'])
  const embedding = new Set(['/api/embed', '/api/embeddings'])
  let active = false
  let failure: Error | undefined
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), Math.max(1, budget.expiresAt - Date.now()))
  const server = http.createServer(async (request, response) => {
    try {
      const endpoint = request.url || ''
      if (!readOnly.has(endpoint) && !generation.has(endpoint) && !embedding.has(endpoint)) throw new Error('Unsupported smoke endpoint')
      if (endpoint === '/api/show' || generation.has(endpoint) || embedding.has(endpoint) ? request.method !== 'POST' : request.method !== 'GET')
        throw new Error('Unsupported smoke method')
      budget.remaining()
      const chunks: Buffer[] = []
      let length = 0
      for await (const chunk of request) {
        length += chunk.length
        if (length > 2 * 1024 * 1024) throw new Error('Smoke request too large')
        chunks.push(Buffer.from(chunk))
      }
      const raw = Buffer.concat(chunks)
      const body = raw.length ? (JSON.parse(raw.toString('utf8')) as { model?: string }) : undefined
      const inference = generation.has(endpoint) || embedding.has(endpoint)
      if (inference) {
        if (active) throw new Error('Concurrent smoke inference refused')
        const kind = embedding.has(endpoint) ? 'embedding' : 'generation'
        const selected = config.models.find((entry) => entry.model === body?.model && (entry.role === 'embedding') === (kind === 'embedding'))
        if (!selected) throw new Error('Only assigned models may be used')
        budget.reserve(kind, selected.role, selected.model)
        active = true
      }
      try {
        const upstream = await fetch(new URL(endpoint, config.host), {
          method: request.method,
          redirect: 'error',
          signal: AbortSignal.any([stop.signal, AbortSignal.timeout(budget.remaining())]),
          ...(raw.length ? { body: raw, headers: { 'Content-Type': 'application/json' } } : {}),
        })
        response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' })
        if (upstream.body)
          for await (const chunk of upstream.body) {
            if (response.destroyed) throw new Error('Smoke client disconnected')
            response.write(chunk)
          }
        response.end()
        if (!upstream.ok) throw new Error(`Upstream failed: ${upstream.status}`)
      } finally {
        if (inference) active = false
      }
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error))
      if (!response.headersSent) response.writeHead(503, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: failure.message }))
    }
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
  } catch (error) {
    clearTimeout(timer)
    budget.close()
    throw error
  }
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No local smoke proxy address')
  return {
    settings: config.settings,
    host: `http://127.0.0.1:${address.port}`,
    async close() {
      clearTimeout(timer)
      stop.abort()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      try {
        const digest = createHash('sha256').update(fs.readFileSync(args.settingsFile)).digest('hex')
        if (digest !== config.digest) throw new Error('Source settings changed during smoke; preserve evidence and inspect')
      } finally {
        budget.close()
      }
      if (failure) throw failure
    },
  }
}
