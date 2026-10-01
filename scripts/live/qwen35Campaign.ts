import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AppSettings, OllamaSamplingOverrides } from '../../shared/types'
import { DEFAULT_APP_SETTINGS } from '../../shared/domain/settings/appSettingsDefaults'
import { LIVE_RUN_ROOT, loadRealSettings } from './agentLiveHarness'

export const QWEN35_MODEL = 'qwen3.5:9b'

/** A transparent recorder: every generation still reaches the real local Ollama. */
export async function createQwen35Campaign(
  label: string,
  sampling: OllamaSamplingOverrides = { temperature: 0.6, top_p: 0.95, top_k: 20, min_p: 0, presence_penalty: 0, repeat_penalty: 1 },
) {
  if (process.env.ONLYRAG_LIVE_MODEL && process.env.ONLYRAG_LIVE_MODEL !== QWEN35_MODEL) {
    throw new Error(`This campaign requires ${QWEN35_MODEL}.`)
  }
  process.env.ONLYRAG_LIVE_MODEL = QWEN35_MODEL
  const originalSettings = loadRealSettings()
  const upstream = new URL(originalSettings.ollamaHost)
  if (upstream.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname)) {
    throw new Error('The Qwen 3.5 campaign requires a local HTTP Ollama endpoint.')
  }
  const root = path.join(LIVE_RUN_ROOT, `${label}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`)
  fs.mkdirSync(root, { recursive: true })
  const sources = path.join(root, 'sources')
  fs.mkdirSync(sources)
  for (const name of [
    'qwen35Campaign.ts',
    'coverageSemantics.live.ts',
    'taskLabPrompts.ts',
    'taskLabSequence.live.ts',
    'taskLabVerification.ts',
    'codingCoverageMatrix.live.ts',
    'codingScenarios.live.ts',
  ]) {
    fs.copyFileSync(path.join(process.cwd(), 'scripts/live', name), path.join(sources, name))
  }
  for (const name of [
    'planRequestCoverage.ts',
    'planGenerationAppService.ts',
    'agentInterviewAppService.ts',
    'runTestsTool.ts',
    'agentOrchestratorCircuitBreakerAndVerification.ts',
  ]) {
    fs.copyFileSync(path.join(process.cwd(), 'electron/core/application', name), path.join(sources, name))
  }
  fs.copyFileSync(path.join(process.cwd(), 'shared/domain/agent/planCompilation.ts'), path.join(sources, 'planCompilation.ts'))
  fs.copyFileSync(path.join(process.cwd(), 'electron/core/domain/agent/tools/toolExecutionContracts.ts'), path.join(sources, 'toolExecutionContracts.ts'))
  const [version, tags, model] = await Promise.all([
    fetch(new URL('/api/version', upstream)).then((response) => response.json()) as Promise<{ version: string }>,
    fetch(new URL('/api/tags', upstream)).then((response) => response.json()) as Promise<{ models: Array<{ name: string; digest: string; size: number }> }>,
    fetch(new URL('/api/show', upstream), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: QWEN35_MODEL }),
    }).then((response) => response.json()) as Promise<{ details: unknown; capabilities: string[]; parameters: string; model_info: unknown }>,
  ])
  const installed = tags.models.find((item) => item.name === QWEN35_MODEL)
  if (!installed) throw new Error('qwen3.5:9b is not installed in the configured local Ollama.')
  fs.writeFileSync(
    path.join(root, 'runtime.json'),
    JSON.stringify(
      {
        node: process.version,
        platform: process.platform,
        ollama: version.version,
        model: installed,
        details: model.details,
        capabilities: model.capabilities,
        parameters: model.parameters,
        modelInfo: model.model_info,
      },
      null,
      2,
    ),
    'utf8',
  )
  const active = new Set<http.ClientRequest>()
  const requests: Array<{ id: number; file: string; thinking: boolean }> = []
  const proxy = http.createServer((incoming, outgoing) => {
    let body = ''
    incoming.setEncoding('utf8')
    incoming.on('data', (chunk: string) => (body += chunk))
    incoming.on('end', () => {
      const isChat = incoming.url === '/api/chat' || incoming.url === '/api/generate'
      const id = requests.length + 1
      let responseFile: string | undefined
      if (isChat) {
        const payload = JSON.parse(body) as { model?: string; think?: boolean }
        if (payload.model !== QWEN35_MODEL || payload.think !== true) {
          outgoing.writeHead(400, { 'Content-Type': 'application/json' })
          outgoing.end(JSON.stringify({ error: 'Campaign generation must use qwen3.5:9b with think=true.' }))
          return
        }
        fs.writeFileSync(path.join(root, `request-${id}.json`), body, 'utf8')
        responseFile = path.join(root, `response-${id}.ndjson`)
        requests.push({ id, file: responseFile, thinking: payload.think })
      }
      const forward = http.request(new URL(incoming.url || '/', upstream), { method: incoming.method, headers: incoming.headers }, (response) => {
        outgoing.writeHead(response.statusCode || 502, response.headers)
        response.on('data', (chunk: Buffer) => {
          if (responseFile) fs.appendFileSync(responseFile, chunk)
        })
        response.pipe(outgoing)
        response.on('error', (error) => outgoing.destroy(error))
      })
      active.add(forward)
      forward.on('close', () => active.delete(forward))
      forward.on('error', (error) => {
        if (responseFile) fs.writeFileSync(`${responseFile}.error.json`, JSON.stringify({ error: error.message }), 'utf8')
        if (!outgoing.headersSent) outgoing.writeHead(502, { 'Content-Type': 'application/json' })
        outgoing.end(JSON.stringify({ error: error.message }))
      })
      outgoing.on('close', () => {
        if (!outgoing.writableFinished) forward.destroy()
      })
      forward.end(body)
    })
  })
  await new Promise<void>((resolve, reject) => {
    proxy.once('error', reject)
    proxy.listen(0, '127.0.0.1', resolve)
  })
  const address = proxy.address()
  if (!address || typeof address === 'string') throw new Error('Campaign recorder has no assigned port.')
  const settings: AppSettings = {
    ...DEFAULT_APP_SETTINGS,
    language: 'en',
    enableCodingAgentDebugLog: true,
    includeCodingAgentDebugPayloads: true,
    verifyBeforeFinish: true,
    customPromptOverrides: {},
    codingModel: QWEN35_MODEL,
    ollamaHost: `http://127.0.0.1:${address.port}`,
    modelThinkingPreferences: { [QWEN35_MODEL]: true },
    modelSamplingOverrides: {
      [QWEN35_MODEL]: sampling,
    },
    modelContextLengths: { [QWEN35_MODEL]: 16384 },
    agentSessionTimeoutMinutes: 180,
    maxToolCallSteps: 50,
    allowFileModifications: true,
    allowTerminalExecution: true,
    fullAccess: false,
    capabilityPolicyMode: 'network-approved',
  }
  const metadata = { label, model: QWEN35_MODEL, think: true, context: 16384, sampling, sessionTimeoutMinutes: 180, maxToolCallSteps: 50, requests }
  fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify(settings, null, 2), 'utf8')
  fs.writeFileSync(path.join(root, 'campaign.json'), JSON.stringify(metadata), 'utf8')
  console.log(`Campaign evidence: ${root}`)
  return {
    root,
    settings,
    requests,
    async close() {
      for (const request of active) request.destroy()
      proxy.closeAllConnections()
      await new Promise<void>((resolve, reject) => proxy.close((error) => (error ? reject(error) : resolve())))
      fs.writeFileSync(path.join(root, 'campaign.json'), JSON.stringify(metadata), 'utf8')
    },
  }
}
