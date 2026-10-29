import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SmokeBudget, configuredSmokeSettings, runConfiguredModelSmoke, startConfiguredSmokeProxy } from './configuredModelSmokeCore'

describe('configured model functional smoke', () => {
  let root: string
  let settingsFile: string
  let sessionDirectory: string
  const saved = {
    customWorkspacePath: 'C:/personal-workspace-do-not-access',
    ollamaHost: 'http://127.0.0.1:11434',
    chatModel: 'manual-chat:latest',
    codingModel: 'manual-code:latest',
    translationModel: 'manual-translation:latest',
    embeddingModel: 'manual-encoder:latest',
    modelContextLengths: { 'manual-chat:latest': 8192 },
    modelThinkingPreferences: { 'manual-chat:latest': false },
    modelSamplingOverrides: { 'manual-chat:latest': { temperature: 0.2, top_p: 0.8 } },
  }
  const writeSettings = (settings: Record<string, unknown> = saved) => fs.writeFileSync(settingsFile, JSON.stringify({ version: 2, settings }))
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-smoke-tests-'))
    settingsFile = path.join(root, 'settings.json')
    sessionDirectory = path.join(root, 'session')
    writeSettings()
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('uses exact manually saved role assignments, sampling, context and thinking without changing source bytes', async () => {
    const original = fs.readFileSync(settingsFile)
    const calls: Array<{ url: string; body: Record<string, unknown> | undefined }> = []
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      const endpoint = String(url)
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ url: endpoint, body })
      if (endpoint.endsWith('/api/tags'))
        return Response.json({
          models: Object.values(saved)
            .filter((v) => typeof v === 'string' && v.startsWith('manual-'))
            .map((name) => ({ name })),
        })
      if (endpoint.endsWith('/api/embed')) return Response.json({ embeddings: [[0.1, 0.2]] })
      return Response.json({ done: true, message: { content: 'Functional output.' } })
    })
    const result = await runConfiguredModelSmoke({ settingsFile, sessionDirectory, roles: ['chat', 'coding', 'translation', 'embedding'] }, fetcher)
    expect(calls[1].body).toMatchObject({ model: saved.chatModel, think: false, options: { temperature: 0.2, top_p: 0.8, num_ctx: 8192 } })
    expect(calls.slice(1).map((c) => c.body?.model)).toEqual([saved.chatModel, saved.codingModel, saved.translationModel, saved.embeddingModel])
    expect(fetcher).toHaveBeenCalledTimes(5)
    expect(fs.readFileSync(settingsFile)).toEqual(original)
    const copy = JSON.parse(fs.readFileSync(path.join(result.runDirectory, 'settings.json'), 'utf8'))
    expect(copy.settings.translationOutputFolder.startsWith(result.runDirectory)).toBe(true)
    expect(copy.settings.customWorkspacePath).toBe(path.join(result.runDirectory, 'workspace'))
    expect(copy.settings.autoInstallHubSkills).toBe('disabled')
    expect(JSON.parse(fs.readFileSync(path.join(result.runDirectory, 'result.json'), 'utf8')).sourceSettingsUnchanged).toBe(true)
  })

  it('refuses absent assignments instead of application defaults, corrupt envelopes, duplicate roles and remote hosts', () => {
    writeSettings({ ollamaHost: saved.ollamaHost, defaultModel: 'do-not-fallback' })
    expect(() => configuredSmokeSettings(settingsFile, ['chat'])).toThrow('No chat model')
    fs.writeFileSync(settingsFile, JSON.stringify(saved))
    expect(() => configuredSmokeSettings(settingsFile, ['chat'])).toThrow('Unsupported settings')
    writeSettings({ ...saved, ollamaHost: 'https://example.com' })
    expect(() => configuredSmokeSettings(settingsFile, ['chat'])).toThrow('local Ollama')
    writeSettings()
    expect(() => configuredSmokeSettings(settingsFile, ['chat', 'chat'])).toThrow('distinct')
  })

  it('does not generate or replace a missing installed model', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ models: [] }))
    await expect(runConfiguredModelSmoke({ settingsFile, sessionDirectory, roles: ['chat'] }, fetcher)).rejects.toThrow('not installed')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fs.readdirSync(sessionDirectory).filter((f) => f.startsWith('generation-'))).toHaveLength(0)
  })

  it('counts failures and retries across runner restarts, stopping before a fifth generation', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith('/api/tags')
        ? Response.json({ models: [{ name: saved.chatModel }] })
        : Response.json({ error: 'controlled failure' }, { status: 500 }),
    )
    for (let i = 0; i < 4; i++) await expect(runConfiguredModelSmoke({ settingsFile, sessionDirectory, roles: ['chat'] }, fetcher)).rejects.toThrow('500')
    await expect(runConfiguredModelSmoke({ settingsFile, sessionDirectory, roles: ['chat'] }, fetcher)).rejects.toThrow('budget exhausted')
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/api/chat'))).toHaveLength(4)
  })

  it('enforces sixteen embedding batches, five shared minutes and exclusive ownership', () => {
    let now = 1000
    const budget = new SmokeBudget(sessionDirectory, () => now)
    expect(() => new SmokeBudget(sessionDirectory, () => now)).toThrow()
    for (let i = 0; i < 16; i++) budget.reserve('embedding', 'embedding', saved.embeddingModel)
    expect(() => budget.reserve('embedding', 'embedding', saved.embeddingModel)).toThrow('budget exhausted')
    budget.close()
    const restarted = new SmokeBudget(sessionDirectory, () => now)
    now = 301_000
    try {
      expect(() => restarted.reserve('generation', 'chat', saved.chatModel)).toThrow('five-minute')
    } finally {
      restarted.close()
    }
  })

  it('refuses to recreate a missing budget when durable reservations already exist', () => {
    const budget = new SmokeBudget(sessionDirectory)
    budget.reserve('generation', 'chat', saved.chatModel)
    budget.close()
    fs.unlinkSync(path.join(sessionDirectory, 'smoke-budget.json'))
    expect(() => new SmokeBudget(sessionDirectory)).toThrow('automatic reset refused')
    expect(fs.existsSync(path.join(sessionDirectory, 'generation-1.json'))).toBe(true)
    expect(fs.existsSync(path.join(sessionDirectory, 'smoke.lock'))).toBe(false)
  })

  it('propagates timeout abort and keeps its reservation', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith('/api/tags')) return Response.json({ models: [{ name: saved.chatModel }] })
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      throw new DOMException('Timed out', 'TimeoutError')
    })
    await expect(runConfiguredModelSmoke({ settingsFile, sessionDirectory, roles: ['chat'] }, fetcher)).rejects.toThrow('Timed out')
    expect(fs.existsSync(path.join(sessionDirectory, 'generation-1.json'))).toBe(true)
    expect(fs.existsSync(path.join(sessionDirectory, 'smoke.lock'))).toBe(false)
  })

  it('budgets the desktop transport against a controlled local HTTP server and refuses downloads', async () => {
    let calls = 0
    const server = http.createServer(async (req, res) => {
      for await (const _ of req) {
        /* drain request */
      }
      calls++
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ done: true, message: { content: 'fixture' } }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    writeSettings({ ...saved, ollamaHost: `http://127.0.0.1:${port}` })
    const proxy = await startConfiguredSmokeProxy({ settingsFile, sessionDirectory, roles: ['chat'] })
    try {
      for (let i = 0; i < 4; i++) {
        const response = await fetch(`${proxy.host}/api/chat`, { method: 'POST', body: JSON.stringify({ model: saved.chatModel }) })
        expect(response.status).toBe(200)
        await response.json()
      }
      const fifth = await fetch(`${proxy.host}/api/chat`, { method: 'POST', body: JSON.stringify({ model: saved.chatModel }) })
      expect(fifth.status).toBe(503)
      await fifth.json()
      const download = await fetch(`${proxy.host}/api/pull`, { method: 'POST', body: '{}' })
      expect(download.status).toBe(503)
      await download.json()
      expect(calls).toBe(4)
    } finally {
      await expect(proxy.close()).rejects.toThrow('Unsupported smoke endpoint')
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('runs the actual CLI with the installed compiler against a synthetic app profile and local fixture server', async () => {
    let calls = 0
    const server = http.createServer(async (req, res) => {
      for await (const _ of req) {
        /* drain request */
      }
      res.setHeader('content-type', 'application/json')
      if (req.url === '/api/tags') res.end(JSON.stringify({ models: [{ name: saved.chatModel }] }))
      else {
        calls++
        res.end(JSON.stringify({ done: true, message: { content: 'fixture response' } }))
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    const appData = path.join(root, 'appdata')
    fs.mkdirSync(path.join(appData, 'onlyrag-v2'), { recursive: true })
    fs.writeFileSync(
      path.join(appData, 'onlyrag-v2/settings.json'),
      JSON.stringify({ version: 2, settings: { ...saved, ollamaHost: `http://127.0.0.1:${port}` } }),
    )
    try {
      const result = await promisify(execFile)(
        process.execPath,
        [path.join(process.cwd(), 'scripts/e2e/configuredModelSmoke.mjs'), '--session-dir', sessionDirectory, '--roles', 'chat'],
        {
          env: { ...process.env, APPDATA: appData },
          timeout: 12_000,
        },
      )
      expect(result.stdout).toContain('Functional smoke completed')
      expect(calls).toBe(1)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }, 15_000)
})
