import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { validateRequestLedger } from '../../shared/domain/agent/requestCoverageLedger.ts'

const mode = process.env.ONLYRAG_LIVE_LEDGER_PLANNING || 'preflight'
assert(['preflight', 'confirmed-four-v1', 'confirmed-remaining-v1', 'private-claims-v1', 'evidence-inventory-v1'].includes(mode), 'Unknown planning scope')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const reviewFile = 'docs/request-ledger-human-review-2026-10-10.md'
const reviewBytes = fs.readFileSync(path.join(root, reviewFile))
const sha = (value) => createHash('sha256').update(value).digest('hex')
// Git stores Markdown with LF; pin content across checkout line endings.
assert.equal(sha(reviewBytes.toString('utf8').replace(/\r\n/g, '\n')), 'aa4624931069ad67ead930296ac1fa4f2d34951677bef790295eb96fca4ceb4e')
const review = reviewBytes.toString('utf8')
assert(review.includes('contents explicitly human-confirmed'))
const fence = String.fromCharCode(96).repeat(3)
const ledgers = review
  .split(`${fence}json`)
  .slice(1)
  .map((item) => JSON.parse(item.split(fence)[0].trim()))
const frozen = fs.readFileSync(path.join(root, 'scripts/live/fixtures/requestCoverageCases.json'))
assert.equal(sha(frozen), '690a8d86c3070ba8ac2387a6289fef1780d04b1ec70f0cf3257c6f92e4f259e6')
const names = ['retained-card-only-global-claim', 'csv-only-global-claim', 'conditional-property-omitted', 'retained-choice-complete-counterpart']
const cases = JSON.parse(frozen).cases.filter((item) => names.includes(item.name))
assert.equal(ledgers.length, 4)
assert.deepEqual(
  cases.map((item) => item.name),
  names,
)
ledgers.forEach((ledger, index) => {
  assert.equal(ledger.request, cases[index].ledger.request)
  assert.equal(validateRequestLedger(ledger, ledger.request), undefined)
})
assert.equal(
  sha(fs.readFileSync(path.join(root, 'electron/core/application/requestCoverageLedgerDraft.ts'))),
  '854a71b063849f37417f367362f58266f85dd6f2906ea4bd585084b4bed0c1d6',
)
assert.equal(
  sha(fs.readFileSync(path.join(root, 'electron/core/application/planGenerationAppService.ts'))),
  ['confirmed-four-v1', 'confirmed-remaining-v1'].includes(mode)
    ? 'fb7634fe28801dbac74760062e8ec1ece30e1d1d7afd39cc58abf941ff9294b7'
    : mode === 'private-claims-v1'
      ? 'f520bafcd386f29a13ce78ecaded291545aa41f83a00139aac0a45f053800e41'
      : 'ce77011d653fe9d068cf8c8c1a8850df8c105aadbd008ef508aa1da644391a52',
)
if (mode === 'preflight') {
  console.log('PASS four frozen human-confirmed ledgers and source scope; zero Ollama calls, no launch or spent marker')
  process.exit(0)
}

const model = 'qwen3.5:9b'
const upstream = 'http://127.0.0.1:11434'
const version = await fetch(`${upstream}/api/version`).then((response) => {
  assert(response.ok)
  return response.json()
})
const tags = await fetch(`${upstream}/api/tags`).then((response) => {
  assert(response.ok)
  return response.json()
})
const installed = tags.models.find((item) => item.name === model)
assert.equal(version.version, '0.40.2')
assert.equal(installed?.digest, 'c97eb11d70b1acdc88af01eef566c1fe4f7fbe93eb1afc06871132f293ff425a')
const liveRoot = process.env.ONLYRAG_LIVE_ROOT || path.join(os.homedir(), 'OnlyRag-Live')
fs.mkdirSync(liveRoot, { recursive: true })
const continuation = mode === 'confirmed-remaining-v1'
const campaign = continuation ? 'confirmed-remaining-v1' : mode
const priorRoot = path.join(liveRoot, 'request-ledger-planning-confirmed-four-v1-2026-10-10T16-59-06-191Z-e684125c')
let prior
if (continuation) {
  const bytes = fs.readFileSync(path.join(priorRoot, 'report.json'))
  assert.equal(sha(bytes), 'e44660bd08dac764d8cf2ffdd2e0a415a2db5d1a652d1512a8432b5552daaaa3')
  prior = JSON.parse(bytes)
  assert.equal(prior.actualCalls, 2)
  assert.equal(prior.cases.length, 1)
  assert.equal(prior.cases[0].name, names[0])
  assert.equal(prior.cases[0].result.status, 'error')
  assert(!fs.existsSync(path.join(priorRoot, 'input-2.json')))
  for (const [file, hash] of Object.entries(prior.sourceSha256)) {
    if (file !== 'scripts/e2e/requestLedgerPlanning.mjs') assert.equal(sha(fs.readFileSync(path.join(root, file))), hash)
  }
}
// Spending a marker is irreversible for this campaign, even if capture fails.
fs.writeFileSync(
  path.join(liveRoot, `request-ledger-planning-${campaign}-replay.json`),
  JSON.stringify({
    names: continuation ? names.slice(1) : names,
    maximumActualCalls: 16,
    priorActualCalls: prior?.actualCalls || 0,
    startedAt: new Date().toISOString(),
  }),
  { flag: 'wx' },
)
const evidence = path.join(liveRoot, `request-ledger-planning-${campaign}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`)
const profile = path.join(evidence, 'isolated-profile')
const workspace = path.join(evidence, 'workspace with spaces')
fs.mkdirSync(profile, { recursive: true })
fs.mkdirSync(workspace)
fs.mkdirSync(path.join(evidence, 'sources'))
fs.writeFileSync(path.join(workspace, 'README.md'), '# Isolated planning capture fixture\n')
fs.writeFileSync(path.join(evidence, 'runtime.json'), JSON.stringify({ version, installed }, null, 2))
fs.writeFileSync(path.join(evidence, 'confirmed-ledgers.json'), JSON.stringify(ledgers, null, 2))
fs.writeFileSync(path.join(evidence, 'frozen-cases.json'), frozen)
const report = {
  captureComplete: false,
  semanticAccepted: null,
  declaredCases: 4,
  actualCalls: prior?.actualCalls || 0,
  maximumActualCalls: 16,
  humanContentsConfirmed: true,
  cases: prior?.cases || [],
  priorEvidence: continuation ? priorRoot : null,
  transportEvents: [],
  sourceSha256: {},
}
for (const file of [
  'scripts/e2e/requestLedgerPlanning.mjs',
  reviewFile,
  'electron/core/application/planGenerationAppService.ts',
  'electron/core/application/structuredGenerationRecovery.ts',
  'electron/core/application/planRequestCoverage.ts',
  'electron/core/application/requestCoverageLedgerDraft.ts',
  'shared/domain/agent/requestCoverageLedger.ts',
  'electron/core/application/ollamaAppService.ts',
  'electron/core/infrastructure/http/ollamaHttpClient.ts',
  'electron/core/domain/agent/ollamaStructuredResponse.ts',
  'dist-electron/main.js',
]) {
  const bytes = fs.readFileSync(path.join(root, file))
  report.sourceSha256[file] = sha(bytes)
  fs.writeFileSync(path.join(evidence, 'sources', path.basename(file)), bytes)
}
let activeCase = 0
let callsForCase = 0
let application
let fatal
const active = new Set()
// Transparent local recorder. Native two-candidate/recovery guards remain authoritative.
const server = http.createServer(async (incoming, outgoing) => {
  let responseFile
  let cancelled = false
  try {
    let raw = ''
    for await (const chunk of incoming) raw += chunk
    if (incoming.url === '/api/chat' || incoming.url === '/api/generate') {
      const body = raw ? JSON.parse(raw) : {}
      if (incoming.url === '/api/chat' || body.prompt) {
        assert.equal(body.model, model)
        assert.equal(body.think, true)
        assert.equal(body.options?.num_ctx, 16384)
        assert(body.format, 'Unexpected non-structured generation')
        assert(!body.format.properties?.obligations, 'Extraction is outside this confirmed-ledger budget')
        assert(callsForCase < 4 && report.actualCalls < 16, 'Approved planning budget exhausted')
        callsForCase++
        report.actualCalls++
        fs.writeFileSync(path.join(evidence, `request-${report.actualCalls}.json`), raw)
        responseFile = path.join(evidence, `response-${report.actualCalls}.ndjson`)
      }
    }
    const forward = http.request(new URL(incoming.url, upstream), { method: incoming.method, headers: incoming.headers }, (response) => {
      outgoing.writeHead(response.statusCode || 502, response.headers)
      response.on('data', (chunk) => {
        if (responseFile) fs.appendFileSync(responseFile, chunk)
      })
      response.pipe(outgoing)
      response.on('error', (error) => {
        report.transportEvents.push({
          url: incoming.url,
          inference: Boolean(responseFile),
          cancelled,
          phase: 'response',
          error: error.message,
          code: error.code,
        })
        if (!cancelled && responseFile) fatal = error
        outgoing.destroy(error)
      })
    })
    active.add(forward)
    forward.once('close', () => active.delete(forward))
    forward.once('error', (error) => {
      report.transportEvents.push({ url: incoming.url, inference: Boolean(responseFile), cancelled, error: error.message, code: error.code })
      if (!cancelled && responseFile) fatal = error
      if (outgoing.destroyed) return
      if (!outgoing.headersSent) outgoing.writeHead(502)
      outgoing.end(JSON.stringify({ error: error.message }))
    })
    outgoing.once('close', () => {
      if (!outgoing.writableFinished) {
        cancelled = true
        forward.destroy()
      }
    })
    forward.end(raw)
  } catch (error) {
    fatal = error
    if (!outgoing.headersSent) outgoing.writeHead(400)
    outgoing.end(JSON.stringify({ error: error.message }))
  }
})
const save = () => fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(`Evidence: ${evidence}`)
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const settings = {
    language: 'en',
    hasCompletedInitialSetup: true,
    defaultModel: model,
    codingModel: model,
    ollamaHost: `http://127.0.0.1:${server.address().port}`,
    enablePrePlanInterview: false,
    enableSkillRouter: false,
    autoInstallHubSkills: 'disabled',
    modelContextLengths: { [model]: 16384 },
    modelThinkingPreferences: { [model]: true },
    modelSamplingOverrides: { [model]: { temperature: 1, top_p: 0.95, top_k: 20, min_p: 0, presence_penalty: 1.5, repeat_penalty: 1 } },
  }
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ version: 2, settings }))
  const launchOptions = {
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [path.join(root, 'dist-electron/main.js'), '--disable-gpu'],
    cwd: root,
    env: { ...process.env, ONLYRAG_E2E_TEST: '1', ONLYRAG_E2E_USER_DATA: profile, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
    timeout: 30000,
  }
  application = await electron.launch(launchOptions)
  let page = await application.firstWindow()
  await page.waitForFunction(() => Boolean(window.electronAPI))
  // Restart the owned application before the real qualification calls.
  await application.close()
  application = await electron.launch(launchOptions)
  page = await application.firstWindow()
  await page.waitForFunction(() => Boolean(window.electronAPI))
  for (activeCase = continuation ? 1 : 0; activeCase < 4; activeCase++) {
    callsForCase = 0
    const started = Date.now()
    const ledger = ledgers[activeCase]
    const payload = {
      prompt: ledger.request,
      confirmedCoverage: ledger,
      model,
      settings,
      workspacePath: workspace,
      previousDecisions: cases[activeCase].decisions.map((decision, index) => ({
        questionId: `confirmed-${index}`,
        questionText: 'Explicit original decision',
        selectedOption: decision,
        provenance: 'explicit',
      })),
    }
    fs.writeFileSync(path.join(evidence, `input-${activeCase + 1}.json`), JSON.stringify(payload, null, 2))
    const result = await page.evaluate((request) => window.electronAPI.agentPlanGenerate(request), payload)
    report.cases.push({ name: names[activeCase], result, elapsedMs: Date.now() - started, actualCalls: callsForCase })
    save()
    console.log(`${names[activeCase]}: ${result.status}; ${callsForCase} real call(s); independent review pending`)
    if (fatal) throw fatal
  }
  report.captureComplete = report.cases.length === 4
  report.limits =
    'Real candidate capture through restarted Electron/preload/secure IPC/Main and local Ollama; independent complete request/ledger/decision/plan review remains required. No new extraction, ambiguity answers, plan approval/seeding/execution, TaskLab or personal migration.'
  assert.equal(fs.readFileSync(path.join(workspace, 'README.md'), 'utf8'), '# Isolated planning capture fixture\n')
  if (report.cases.some((item) => item.result.status !== 'success')) process.exitCode = 1
} catch (error) {
  report.error = error.stack || String(error)
  throw error
} finally {
  save()
  if (application) await application.close()
  for (const request of active) request.destroy()
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}
