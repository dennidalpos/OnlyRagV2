import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright'
import { validateRequestLedger } from '../../shared/domain/agent/requestCoverageLedger.ts'
import { LedgerCallBudget } from './ledgerCallBudget.ts'

// New explicit authorization, 2026-10-20: four extraction calls plus four planning calls.
// Fixed root/marker: neither an env override nor restarting this script resets the authorization.
const label = 'request-ledger-bounded-20261020-v1'
const continuation = process.argv.includes('--continue-unspent')
const liveRoot = path.join(os.homedir(), 'OnlyRag-Live')
const evidence = path.join(liveRoot, label)
const marker = path.join(liveRoot, `${label}-replay.json`)
const sha = (value) => createHash('sha256').update(value).digest('hex')
const model = 'qwen3.5:9b'
const upstream = 'http://127.0.0.1:11434'
const names = ['retained-card-only-global-claim', 'csv-only-global-claim', 'conditional-property-omitted', 'retained-choice-complete-counterpart']
const reviewFile = 'docs/request-ledger-human-review-2026-10-10.md'
const review = fs.readFileSync(reviewFile, 'utf8')
assert.equal(sha(review.replace(/\r\n/g, '\n')), 'aa4624931069ad67ead930296ac1fa4f2d34951677bef790295eb96fca4ceb4e')
const fence = String.fromCharCode(96).repeat(3)
const ledgers = review
  .split(`${fence}json`)
  .slice(1)
  .map((item) => JSON.parse(item.split(fence)[0].trim()))
const frozen = fs.readFileSync('scripts/live/fixtures/requestCoverageCases.json')
assert.equal(sha(frozen), '690a8d86c3070ba8ac2387a6289fef1780d04b1ec70f0cf3257c6f92e4f259e6')
const cases = JSON.parse(frozen).cases.filter((item) => names.includes(item.name))
assert.deepEqual(
  cases.map((item) => item.name),
  names,
)
assert.equal(ledgers.length, 4)
for (const [index, ledger] of ledgers.entries()) {
  assert.equal(ledger.request, cases[index].ledger.request)
  assert.equal(validateRequestLedger(ledger, ledger.request), undefined)
}
const sourcePins = {
  'electron/core/application/requestCoverageLedgerDraft.ts': '0436bf80f9186055530fa15e3be75acfaff48dcbd65de0035cb4c0c639597876',
  'electron/core/application/planGenerationAppService.ts': 'd147513d24fc6b86d8bdfd2779c18866c54e6ebfa293ff667c69b50f561a9793',
  'electron/core/application/planRequestCoverage.ts': '957e175cab303f70a6b1697f6f92068b08c29c41743d908602d7f5a03743fc67',
  'dist-electron/main.js': 'd74ac82c2246ea4e9fc58e0fec54663d5a49889c5cf2a8d2b22f401c6d21a2cd',
}
for (const [file, hash] of Object.entries(sourcePins)) assert.equal(sha(fs.readFileSync(file)), hash, `Source drift: ${file}`)
if (!process.argv.includes('--run') && !continuation) {
  assert.deepEqual(process.argv.slice(2), [], 'Only --run activates the approved campaign')
  console.log('PASS frozen confirmed ledgers, source/build pins; zero inference, no marker or app launch')
  process.exit(0)
}
assert.deepEqual(process.argv.slice(2), [continuation ? '--continue-unspent' : '--run'])
const executablePath = process.env.ONLYRAG_QUALIFICATION_EXE
assert(executablePath && path.isAbsolute(executablePath) && fs.existsSync(executablePath), 'Select the installed candidate explicitly')
const releaseRoot = path.resolve('release/cpu-20261020-130728-0e85c502')
const release = JSON.parse(fs.readFileSync(path.join(releaseRoot, 'release-manifest.json'), 'utf8'))
assert.equal(sha(fs.readFileSync(path.join(releaseRoot, release.installer.path))), release.installer.sha256)
for (const file of release.files) {
  assert(file.path.startsWith('win-unpacked/'))
  const installedFile = path.join(path.dirname(executablePath), file.path.slice('win-unpacked/'.length))
  assert.equal(sha(fs.readFileSync(installedFile)), file.sha256, `Installed payload mismatch: ${file.path}`)
}
const metadata = async (endpoint) => {
  const response = await fetch(`${upstream}${endpoint}`)
  assert(response.ok)
  return response.json()
}
const version = await metadata('/api/version')
const tags = await metadata('/api/tags')
assert.equal(version.version, '0.40.6')
assert.equal(tags.models.find((item) => item.name === model)?.digest, 'c97eb11d70b1acdc88af01eef566c1fe4f7fbe93eb1afc06871132f293ff425a')
const oldMarkers = Object.fromEntries(
  fs
    .readdirSync(liveRoot)
    .filter((file) => file.endsWith('-replay.json'))
    .map((file) => [file, sha(fs.readFileSync(path.join(liveRoot, file)))]),
)
let priorAttempt
if (continuation) {
  priorAttempt = JSON.parse(fs.readFileSync(path.join(evidence, 'report.json'), 'utf8'))
  assert.equal(priorAttempt.budget.total, 0)
  assert.equal(priorAttempt.cases.length, 0)
  assert.match(priorAttempt.error, /Invalid IPC payload/)
  assert.deepEqual(JSON.parse(fs.readFileSync(marker, 'utf8')).sourcePins, sourcePins)
  fs.copyFileSync(path.join(evidence, 'report.json'), path.join(evidence, 'zero-inference-ipc-failure.json'), fs.constants.COPYFILE_EXCL)
  fs.renameSync(path.join(evidence, 'input-extraction-0.json'), path.join(evidence, 'input-extraction-0-invalid-ipc.json'))
} else {
  assert(!fs.existsSync(evidence), 'This campaign already exists; preserve it and stop')
  fs.writeFileSync(
    marker,
    JSON.stringify({
      label,
      authorized: 'Autorizzo la nuova campagna da massimo 8 chiamate',
      maximum: 8,
      extraction: 4,
      planning: 4,
      names,
      sourcePins,
      startedAt: new Date().toISOString(),
    }),
    { flag: 'wx', flush: true },
  )
  fs.mkdirSync(evidence)
  fs.copyFileSync(marker, path.join(evidence, 'spent-marker.json'))
}
const budget = new LedgerCallBudget(evidence, continuation)
const profile = path.join(evidence, 'isolated-profile')
const workspace = path.join(evidence, 'workspace with spaces')
if (!continuation) {
  fs.mkdirSync(profile)
  fs.mkdirSync(workspace)
  fs.mkdirSync(path.join(evidence, 'sources'))
}
const workspaceOriginal = '# Isolated planning capture fixture\n'
if (!continuation) fs.writeFileSync(path.join(workspace, 'README.md'), workspaceOriginal)
else assert.equal(fs.readFileSync(path.join(workspace, 'README.md'), 'utf8'), workspaceOriginal)
const sourceDirectory = path.join(evidence, 'sources', ...(continuation ? ['continuation'] : []))
if (continuation) fs.mkdirSync(sourceDirectory)
for (const file of [
  ...Object.keys(sourcePins),
  reviewFile,
  'scripts/e2e/requestLedgerBounded.mjs',
  'scripts/e2e/ledgerCallBudget.ts',
  'electron/core/application/structuredGenerationRecovery.ts',
  'shared/domain/agent/requestCoverageLedger.ts',
]) {
  fs.copyFileSync(file, path.join(sourceDirectory, path.basename(file)))
}
fs.writeFileSync(path.join(evidence, 'confirmed-ledgers.json'), JSON.stringify(ledgers, null, 2))
fs.writeFileSync(path.join(evidence, 'frozen-cases.json'), frozen)
const report = {
  priorAttempt,
  label,
  executablePath,
  releaseRoot,
  sourcePins,
  oldMarkers,
  runtime: { version, model: tags.models.find((item) => item.name === model), node: process.version, cpus: os.cpus(), ram: os.totalmem() },
  cases: [],
  denials: [],
  transportErrors: [],
  launches: [],
  audit: [],
  captureComplete: false,
  semanticAccepted: null,
}
const save = () => fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify({ ...report, budget: budget.snapshot() }, null, 2), { flush: true })
let activeCase
let application
const connections = new Set()
const server = http.createServer(async (incoming, outgoing) => {
  let responseFile
  try {
    let raw = ''
    for await (const chunk of incoming) {
      raw += chunk
      assert(Buffer.byteLength(raw) < 10 * 1024 * 1024, 'Oversized campaign request')
    }
    if (incoming.url === '/api/chat' && incoming.method === 'POST') {
      const reservation = budget.reserve(JSON.parse(raw))
      fs.writeFileSync(path.join(evidence, `request-${reservation.id}.json`), raw, { flag: 'wx', flush: true })
      responseFile = path.join(evidence, `response-${reservation.id}.ndjson`)
      save()
      console.log(`Dispatch ${reservation.id}/8: ${reservation.phase} ${names[reservation.index]}`)
    } else {
      assert(
        (incoming.method === 'GET' && ['/api/version', '/api/tags', '/api/ps', '/v1/models'].includes(incoming.url)) ||
          (incoming.method === 'POST' && incoming.url === '/api/show'),
        'Endpoint outside campaign scope',
      )
      if (incoming.method === 'POST')
        assert(
          tags.models.some((item) => item.name === JSON.parse(raw).model),
          'Metadata requested for an uninstalled model',
        )
    }
    const forward = http.request(
      new URL(incoming.url, upstream),
      { method: incoming.method, headers: { ...incoming.headers, host: '127.0.0.1:11434' } },
      (response) => {
        outgoing.writeHead(response.statusCode || 502, response.headers)
        response.on('data', (chunk) => {
          if (responseFile) fs.appendFileSync(responseFile, chunk)
        })
        response.on('error', (error) => {
          report.transportErrors.push({ responseFile, error: error.message })
          save()
          outgoing.destroy(error)
        })
        response.pipe(outgoing)
      },
    )
    connections.add(forward)
    forward.once('close', () => connections.delete(forward))
    forward.once('error', (error) => {
      report.transportErrors.push({ responseFile, error: error.message })
      save()
      if (!outgoing.headersSent) outgoing.writeHead(502)
      outgoing.end(JSON.stringify({ error: error.message }))
    })
    outgoing.once('close', () => {
      if (!outgoing.writableFinished) forward.destroy()
    })
    forward.end(raw)
  } catch (error) {
    report.denials.push({ ...activeCase, url: incoming.url, reason: error.message, at: new Date().toISOString() })
    save()
    if (!outgoing.headersSent) outgoing.writeHead(429, { 'Content-Type': 'application/json' })
    outgoing.end(JSON.stringify({ error: `Campaign scope/budget refusal: ${error.message}` }))
  }
})
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
    enableCodingAgentDebugLog: true,
    codingAgentDebugRetentionFiles: 5,
    enablePrePlanInterview: false,
    enableSkillRouter: false,
    autoInstallHubSkills: 'disabled',
    modelContextLengths: { [model]: 16384 },
    modelThinkingPreferences: { [model]: true },
    modelSamplingOverrides: { [model]: { temperature: 1, top_p: 0.95, top_k: 20, min_p: 0, presence_penalty: 1.5, repeat_penalty: 1 } },
  }
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ version: 2, settings }), { flush: true })
  const env = { ...process.env, ONLYRAG_E2E_TEST: '1', ONLYRAG_E2E_USER_DATA: profile }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ONLYRAG_SMOKE_TEST
  async function launch() {
    application = await electron.launch({ executablePath, args: ['--disable-gpu'], env, timeout: 60000 })
    const identity = await application.evaluate(({ app }) => ({
      userData: app.getPath('userData'),
      packaged: app.isPackaged,
      electron: process.versions.electron,
      pid: process.pid,
    }))
    assert.equal(path.resolve(identity.userData), path.resolve(profile))
    assert.equal(identity.packaged, true)
    assert.equal(identity.electron, '43.7.4')
    report.launches.push(identity)
    save()
    const page = await application.firstWindow()
    await page.waitForFunction(() => Boolean(window.electronAPI?.agentPlanGenerate && window.__onlyragFlushSettings))
    return page
  }
  await launch()
  await application.close()
  application = undefined
  let page = await launch()
  for (const phase of ['extraction', 'planning']) {
    for (let index = 0; index < 4; index++) {
      activeCase = { phase, index, name: names[index] }
      budget.begin(phase, index, ledgers[index].request)
      const started = Date.now()
      const operationId = `${label}-${phase}-${index}`
      const input = {
        identity: {
          runId: operationId,
          conversationId: `${label}-${index}`,
          planRevisionId: `${label}-confirmed-${index}`,
          workspaceId: `workspace:${workspace}`,
        },
        prompt: ledgers[index].request,
        ...(phase === 'planning' ? { confirmedCoverage: ledgers[index] } : {}),
        model,
        settings,
        workspacePath: workspace,
        previousDecisions: cases[index].decisions.map((decision, id) => ({
          questionId: `confirmed-${id}`,
          questionText: 'Explicit original decision',
          selectedOption: decision,
          provenance: 'explicit',
        })),
      }
      fs.writeFileSync(path.join(evidence, `input-${phase}-${index}.json`), JSON.stringify(input, null, 2), { flag: 'wx', flush: true })
      const before = budget.snapshot().total
      const result = await page.evaluate((request) => window.electronAPI.agentPlanGenerate(request), input)
      report.cases.push({ ...activeCase, operationId, elapsedMs: Date.now() - started, actualCalls: budget.snapshot().total - before, result })
      budget.end()
      save()
      console.log(`${phase} ${names[index]}: ${result.status}; ${budget.snapshot().total}/8 calls`)
    }
  }
  // No inference on this restart: read each persisted session through production secure IPC.
  await application.close()
  application = undefined
  page = await launch()
  for (const item of report.cases) {
    const bundle = await page.evaluate((options) => window.electronAPI.exportAiDebugBundle(options), {
      sessionId: item.operationId,
      workspacePath: workspace,
      settings,
      activeModelName: model,
    })
    const file = `audit-${item.phase}-${item.index}.md`
    fs.writeFileSync(path.join(evidence, file), bundle, { flag: 'wx', flush: true })
    assert(bundle.includes(item.operationId), 'Missing persisted operation identity')
    assert(bundle.includes(ledgers[item.index].request), 'Original request missing after restart')
    assert(bundle.includes(item.phase === 'extraction' ? 'REQUEST LEDGER CALL 1' : 'RESPONSE 1'), 'Full trace missing after restart')
    report.audit.push({ operationId: item.operationId, file, sha256: sha(bundle) })
    save()
  }
  for (const [file, hash] of Object.entries(oldMarkers))
    assert.equal(sha(fs.readFileSync(path.join(liveRoot, file))), hash, `Historical marker changed: ${file}`)
  assert.equal(fs.readFileSync(path.join(workspace, 'README.md'), 'utf8'), workspaceOriginal)
  assert.equal(budget.snapshot().total, 8)
  assert.equal(report.audit.length, 8)
  report.captureComplete = report.cases.length === 8 && report.cases.every((item) => item.actualCalls === 1)
  report.limits =
    'One real call per original per phase. Native recovery/review requests are recorded and denied before forwarding. No plan approval/execution, auto-confirmation of drafts, personal data, or automatic Sidecar startup qualification. Independent full semantic review required.'
  if (report.cases.some((item) => item.result.status === 'error')) process.exitCode = 1
} catch (error) {
  report.error = error.stack || String(error)
  process.exitCode = 1
} finally {
  save()
  if (application) await application.close()
  for (const connection of connections) connection.destroy()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}
