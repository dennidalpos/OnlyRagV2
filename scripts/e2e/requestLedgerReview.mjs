import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const source = path.resolve(process.argv[2] || '')
assert(process.argv[2], 'Supply the retained extraction evidence directory')
const reviewPath = path.join(root, 'docs/request-ledger-human-review-2026-10-10.md')
const review = fs.readFileSync(reviewPath, 'utf8')
assert(review.includes('contents explicitly human-confirmed'), 'Human content confirmation is required')
const fence = String.fromCharCode(96).repeat(3)
const confirmed = review
  .split(`${fence}json`)
  .slice(1)
  .map((item) => JSON.parse(item.split(fence)[0].trim()))
const captured = JSON.parse(fs.readFileSync(path.join(source, 'summary.json'), 'utf8'))
assert.equal(confirmed.length, 4)
assert.equal(captured.results.length, 4)
assert.equal(captured.humanConfirmed, false)
confirmed.forEach((ledger, index) => assert.equal(ledger.request, captured.results[index].draft.request))

const evidence = path.join(
  process.env.ONLYRAG_LIVE_ROOT || path.join(os.homedir(), 'OnlyRag-Live'),
  `request-ledger-desktop-replay-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`,
)
const profile = path.join(evidence, 'isolated-profile')
const workspace = path.join(evidence, 'workspace with spaces')
fs.mkdirSync(profile, { recursive: true })
fs.mkdirSync(workspace)
fs.writeFileSync(path.join(workspace, 'README.md'), '# Retained ledger UI replay fixture\n')
console.log(`Evidence: ${evidence}`)
const model = 'qwen3.5:9b'
const requests = []
const held = new Set()
let activeCase = 0
let application
let page
let fixtureError
const report = {
  passed: false,
  actualInferenceCalls: 0,
  transport: 'Declared loopback replay fixture; no upstream Ollama or Sidecar',
  source,
  cases: [],
  checks: [],
  sourceSha256: {},
}
for (const file of [
  'scripts/e2e/requestLedgerReview.mjs',
  'docs/request-ledger-human-review-2026-10-10.md',
  'src/components/coding/RequestScopeReview.tsx',
  'src/hooks/usePlanApproval.ts',
  'electron/core/application/requestCoverageLedgerDraft.ts',
  'dist-electron/main.js',
]) {
  report.sourceSha256[file] = createHash('sha256')
    .update(fs.readFileSync(path.join(root, file)))
    .digest('hex')
}
const save = () => fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n')
// Replay only retained drafts. Candidate requests are held for cancellation, never generated.
const server = http.createServer(async (request, response) => {
  try {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const body = raw ? JSON.parse(raw) : {}
    let result
    if (request.url === '/api/tags')
      result = {
        models: [
          {
            name: model,
            model,
            digest: 'declared-ledger-replay-fixture',
            size: 1000000,
            capabilities: ['completion'],
            details: { parameter_size: '9B', quantization_level: 'Q4_K_M', family: 'qwen35' },
          },
        ],
      }
    else if (request.url === '/v1/models') result = { object: 'list', data: [{ id: model, object: 'model', owned_by: 'fixture' }] }
    else if (request.url === '/api/ps') result = { models: [] }
    else if (request.url === '/api/show') result = { details: { context_length: 16384 }, model_info: { 'qwen35.context_length': 16384 } }
    else if (request.url === '/api/generate') {
      assert(!body.prompt, 'Unexpected prose generation in ledger replay')
      result = { done: true }
    } else if (request.url === '/api/chat') {
      const input = JSON.parse(body.messages.findLast((message) => message.role === 'user').content)
      assert.equal(input.request, confirmed[activeCase].request)
      const kind = body.format?.properties?.obligations ? 'extraction' : 'candidate'
      requests.push({ case: activeCase, kind, body })
      fs.writeFileSync(path.join(evidence, `request-${requests.length}.json`), JSON.stringify(requests.at(-1), null, 2))
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      if (kind === 'candidate') {
        assert.deepEqual(input.confirmedCoverage, confirmed[activeCase])
        response.flushHeaders()
        held.add(response)
        response.once('close', () => held.delete(response))
      } else
        response.end(
          JSON.stringify({
            model,
            message: { role: 'assistant', content: JSON.stringify(captured.results[activeCase].draft) },
            done: true,
            done_reason: 'stop',
          }) + '\n',
        )
      return
    } else throw new Error(`Unexpected replay route: ${request.url}`)
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(result))
  } catch (error) {
    fixtureError = error
    if (!response.headersSent) response.writeHead(500)
    response.end(JSON.stringify({ error: error.message }))
  }
})

async function until(predicate, label) {
  const deadline = Date.now() + 20000
  while (!predicate() && Date.now() < deadline) {
    if (fixtureError) throw fixtureError
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  if (fixtureError) throw fixtureError
  assert(predicate(), label)
}

async function launch(selectWorkspace = true) {
  application = await electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [path.join(root, 'dist-electron/main.js'), '--disable-gpu'],
    cwd: root,
    env: { ...process.env, ONLYRAG_E2E_TEST: '1', ONLYRAG_E2E_USER_DATA: profile, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
    timeout: 30000,
  })
  page = await application.firstWindow()
  page.setDefaultTimeout(20000)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.waitForFunction(() => Boolean(window.electronAPI))
  await application.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, workspace)
  await page.locator('#tab-coding').click()
  if (selectWorkspace) await page.locator('button[aria-label="Select Workspace"]').click()
}

const scope = () => page.getByRole('region', { name: 'Confirm the request scope', exact: true })
async function extract() {
  const before = requests.length
  await page.getByRole('textbox', { name: 'Describe the task or refactoring needed in your workspace...', exact: true }).fill(confirmed[activeCase].request)
  await page.getByRole('button', { name: 'Plan', exact: true }).click()
  await scope().waitFor()
  assert.equal(requests.length, before + 1, 'An unconfirmed draft must make only one fixture extraction request')
  assert.equal(requests.at(-1).kind, 'extraction')
}

async function editConfirmed() {
  const region = scope()
  while ((await region.locator('fieldset').count()) > confirmed[activeCase].obligations.length) {
    await region.locator('fieldset').last().getByRole('button', { name: 'Delete', exact: true }).click()
  }
  for (const [index, obligation] of confirmed[activeCase].obligations.entries()) {
    const field = region.locator('fieldset').nth(index)
    await field.getByLabel(/^Required behavior/).fill(obligation.requirement)
    await field.getByLabel(/^Subject class/).fill(obligation.subject)
    await field.getByLabel(/^Scope/).selectOption(obligation.scope)
    await field.getByLabel(/^Named targets/).fill(obligation.targets.join('\n'))
    await field.getByLabel('This list includes every possible target', { exact: true }).setChecked(obligation.closedInventory)
    await field.getByLabel(/^Conditions/).fill(obligation.conditions.join('\n'))
  }
}

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
    enableSoundEffects: false,
    modelContextLengths: { [model]: 16384 },
    modelThinkingPreferences: { [model]: true },
    enableSkillRouter: false,
    autoInstallHubSkills: 'disabled',
  }
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ version: 2, settings }))
  await launch()
  for (activeCase = 0; activeCase < 4; activeCase++) {
    if (activeCase) await page.getByRole('button', { name: 'New chat', exact: true }).click()
    const beforeSessions = await page.evaluate((folder) => window.electronAPI.listCodingSessions({ workspacePath: folder }), workspace)
    const beforePlans = beforeSessions.reduce((count, session) => count + (session.plans?.length || 0), 0)
    await extract()
    const sessions = await page.evaluate((folder) => window.electronAPI.listCodingSessions({ workspacePath: folder }), workspace)
    assert(sessions.reduce((count, session) => count + (session.plans?.length || 0), 0) === beforePlans, 'Scope capture persisted an empty plan')
    await editConfirmed()
    await page.screenshot({ path: path.join(evidence, `edited-${activeCase + 1}.png`) })
    const before = requests.length
    await scope().getByRole('button', { name: 'Confirm scope and generate plan', exact: true }).click()
    await until(() => held.size === 1, 'Expected the confirmed fixture candidate boundary')
    assert.equal(requests.length, before + 1)
    assert.equal(requests.at(-1).kind, 'candidate')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await until(() => held.size === 0, 'Cancellation did not close the owned fixture candidate stream')
    assert.equal(await scope().count(), 0)
    report.cases.push({
      name: captured.results[activeCase].name,
      editedLedger: confirmed[activeCase],
      candidatePayloadMatched: true,
      cancelled: true,
      actualInferenceCalls: 0,
    })
    console.log(`PASS ${captured.results[activeCase].name}: UI edits, explicit click, exact native payload and cancellation`)
  }
  activeCase = 0
  await page.getByRole('button', { name: 'New chat', exact: true }).click()
  await extract()
  const beforeCancel = requests.length
  await scope().getByRole('button', { name: 'Cancel', exact: true }).click()
  await scope().waitFor({ state: 'detached' })
  assert.equal(requests.length, beforeCancel)
  report.checks.push('Unconfirmed cancellation emits no candidate')
  await extract()
  const beforeSession = requests.length
  await page.getByRole('button', { name: 'New chat', exact: true }).click()
  await scope().waitFor({ state: 'detached' })
  assert.equal(requests.length, beforeSession)
  report.checks.push('Session change invalidates pending confirmation without a candidate')
  const stale = await page.evaluate((payload) => window.electronAPI.agentPlanGenerate(payload), {
    prompt: 'Different request',
    confirmedCoverage: confirmed[0],
    model,
    settings,
    workspacePath: workspace,
  })
  assert.equal(stale.status, 'error')
  assert.match(stale.error, /different request/)
  assert.equal(requests.length, beforeSession)
  report.checks.push('Native IPC rejects confirmation for another request without dispatch')
  await extract()
  const beforeRestart = requests.length
  await application.close()
  application = undefined
  await launch(false)
  assert.equal(await scope().count(), 0)
  assert.equal(requests.length, beforeRestart)
  report.checks.push('Restart does not restore or automatically confirm a pending draft')
  assert(!fixtureError)
  report.passed = true
  report.fixtureRequests = requests.length
  report.limits =
    'Native desktop replay only. Real Main/preload/renderer/hook and isolated persistence; captured extraction responses, synthetic metadata and held candidate transport. No real model/Sidecar, generated candidate, ambiguity interview, TaskLab or causal quality qualification.'
} catch (error) {
  report.error = error.stack || String(error)
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(evidence, 'failure.png') })
  throw error
} finally {
  save()
  if (application) await application.close()
  for (const response of held) response.destroy()
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}
