import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { _electron as electron } from 'playwright'

const executablePath = process.env.ONLYRAG_QUALIFICATION_EXE
const evidence = process.env.ONLYRAG_QUALIFICATION_EVIDENCE
assert(executablePath && path.isAbsolute(executablePath) && fs.existsSync(executablePath))
assert(evidence && path.isAbsolute(evidence) && !fs.existsSync(evidence))
const python = path.resolve('.venv/Scripts/python.exe')
const helper = path.resolve('scripts/e2e/installedXlsProbe.py')
const userData = path.join(evidence, 'profile')
const sidecarExe = path.join(path.dirname(executablePath), 'resources/sidecar/sidecar.exe')
async function hash(file) {
  const digest = createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk)
  return digest.digest('hex')
}
async function occupied(port) {
  return new Promise((resolve) => {
    const probe = net.connect({ host: '127.0.0.1', port })
    probe.once('connect', () => {
      probe.destroy()
      resolve(true)
    })
    probe.once('error', () => {
      probe.destroy()
      resolve(false)
    })
  })
}
for (const port of [8000, 9]) assert.equal(await occupied(port), false, `Port ${port} occupied; refuse foreign owner`)
const release = JSON.parse(fs.readFileSync('release/cpu-20261020-130728-0e85c502/release-manifest.json', 'utf8'))
for (const file of release.files) {
  assert(file.path.startsWith('win-unpacked/'))
  assert.equal(await hash(path.join(path.dirname(executablePath), file.path.slice('win-unpacked/'.length))), file.sha256)
}
fs.mkdirSync(evidence)
fs.mkdirSync(userData)
fs.mkdirSync(path.join(evidence, 'sources'))
for (const file of [
  'scripts/e2e/installedXls.mjs',
  'scripts/e2e/installedXlsProbe.py',
  'sidecar/tests/_xls_fixtures.py',
  'sidecar/infrastructure/xls_process.py',
  'sidecar/xls_worker.py',
  'sidecar/domain/xls_reader.py',
]) {
  fs.copyFileSync(file, path.join(evidence, 'sources', path.basename(file)))
}
fs.writeFileSync(
  path.join(userData, 'settings.json'),
  JSON.stringify({
    version: 2,
    settings: {
      language: 'en',
      hasCompletedInitialSetup: true,
      ollamaHost: 'http://127.0.0.1:9',
      defaultModel: 'qwen3.5:9b',
      embeddingModel: 'nomic-embed-text:latest',
      autoInstallHubSkills: 'disabled',
    },
  }),
)
const report = {
  executablePath,
  sidecarExe,
  installerSha256: release.installer.sha256,
  cases: [],
  startup: [],
  complete: false,
  realModelCalls: 0,
  embeddingMode: 'Production versioned fallback; intentionally unreachable loopback port 9. No encoder quality claim.',
}
const save = () => fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2))
async function runPython(mode, label = '', extra = []) {
  const log = fs.openSync(path.join(evidence, `${mode}-${label || 'prepare'}.log`), 'wx')
  const child = spawn(python, ['-B', helper, mode, '--root', evidence, ...(label ? ['--label', label] : []), ...extra], {
    windowsHide: true,
    stdio: ['ignore', log, log],
  })
  fs.closeSync(log)
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code))
  })
  return { child, completion }
}
async function snapshot(label) {
  const running = await runPython('snapshot', label)
  assert.equal(await running.completion, 0, `Logical index snapshot failed: ${label}`)
  return JSON.parse(fs.readFileSync(path.join(evidence, `index-${label}.json`), 'utf8'))
}
async function archiveHashes() {
  const root = path.join(userData, 'data/source-documents')
  const result = {}
  async function visit(directory) {
    if (!fs.existsSync(directory)) return
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      assert(!entry.isSymbolicLink())
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(file)
      else result[path.relative(root, file)] = await hash(file)
    }
  }
  await visit(root)
  return result
}
let application
let page
let sheets = 2
let observer
let lastSidecarPid
async function launch() {
  const env = { ...process.env, ONLYRAG_EXCEL_MAX_SHEETS: String(sheets) }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ONLYRAG_E2E_TEST', 'ONLYRAG_E2E_USER_DATA', 'ONLYRAG_SMOKE_TEST']) delete env[key]
  application = await electron.launch({ executablePath, args: [`--user-data-dir=${userData}`, '--disable-gpu'], env, timeout: 60000 })
  const identity = await application.evaluate(({ app }) => ({
    userData: app.getPath('userData'),
    packaged: app.isPackaged,
    testMode: process.env.ONLYRAG_E2E_TEST || null,
    pid: process.pid,
  }))
  assert.equal(path.resolve(identity.userData), path.resolve(userData))
  assert.equal(identity.packaged, true)
  assert.equal(identity.testMode, null)
  page = await application.firstWindow()
  await page.waitForFunction(() => Boolean(window.electronAPI?.ingestFile))
  await ready(identity)
}
async function ready(identity = {}) {
  const deadline = Date.now() + 60000
  let documents
  let marker
  while (Date.now() < deadline) {
    try {
      documents = await page.evaluate(() => window.electronAPI.getIngestedDocuments())
    } catch {}
    if (Array.isArray(documents) && fs.existsSync(path.join(userData, 'sidecar-ownership.json'))) {
      marker = JSON.parse(fs.readFileSync(path.join(userData, 'sidecar-ownership.json'), 'utf8'))
      if (marker.pid !== lastSidecarPid) break
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert(Array.isArray(documents))
  assert(marker && marker.pid !== lastSidecarPid, 'Fresh ownership marker not acknowledged')
  assert.equal(path.resolve(marker.executablePath), path.resolve(sidecarExe))
  lastSidecarPid = marker.pid
  report.startup.push({ ...identity, marker, sheets, count: documents.length })
  save()
  return marker
}
async function ingest(label, file, { full = true, action = 'monitor', error, contains = [], excludes = [] } = {}) {
  const before = await snapshot(`${label}-before`)
  const archives = await archiveHashes()
  const marker = JSON.parse(fs.readFileSync(path.join(userData, 'sidecar-ownership.json'), 'utf8'))
  observer = await runPython('observe', label, ['--sidecar-pid', String(marker.pid), '--exe', sidecarExe, '--action', action])
  const deadline = Date.now() + 10000
  while (!fs.existsSync(path.join(evidence, `${label}.ready.json`))) {
    assert(Date.now() < deadline && observer.child.exitCode === null, `Observer initialization failed: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  const taskId = randomUUID()
  const started = Date.now()
  let result
  try {
    result = await page
      .evaluate((request) => window.electronAPI.ingestFile(request), {
        filePath: path.join(evidence, 'inputs', file),
        normalizeWithLlm: false,
        allowFullExcelFormat: full,
        taskId,
      })
      .catch((failure) => ({ success: false, error: String(failure) }))
  } finally {
    fs.writeFileSync(path.join(evidence, `${label}.stop`), '')
    assert.equal(await observer.completion, 0, `Owned-process observer failed: ${label}`)
    observer = undefined
  }
  const observation = JSON.parse(fs.readFileSync(path.join(evidence, `observe-${label}.json`), 'utf8'))
  const item = { label, file, taskId, action, full, elapsedMs: Date.now() - started, result, observation }
  report.cases.push(item)
  save()
  console.log(`${label}: ${result.success ? 'success' : result.error}; ${observation.workers.length} owned parser(s)`)
  if (action === 'owner-crash') {
    assert.equal(result.success, false)
    assert.equal(observation.workerExitedWithinFiveSecondsOfOwner, true)
    const restarted = await page.evaluate(() => window.electronAPI.restartSidecar())
    assert.equal(restarted.success, true)
    const markerAfter = await ready()
    assert.notEqual(markerAfter.pid, marker.pid)
  } else if (error) {
    assert.equal(result.success, false)
    assert.match(result.error || '', error)
  } else {
    assert.equal(result.success, true, result.error)
    assert.equal(result.data.usedFallbackEmbeddings, true)
    for (const text of contains) assert(result.data.extractedMarkdown.includes(text), `${label}: missing ${text}`)
    for (const text of excludes) assert(!result.data.extractedMarkdown.includes(text), `${label}: unexpected ${text}`)
  }
  for (const worker of observation.workers) {
    assert.equal(worker.inJob, true)
    assert.equal(worker.exited, true)
    assert(worker.peakCommitBytes > 0 && worker.peakCommitBytes <= 512 * 1024 * 1024)
  }
  if (full && action !== 'admission-refusal') assert(observation.workers.length >= 1)
  const afterArchives = await archiveHashes()
  for (const [file, digest] of Object.entries(archives)) assert.equal(afterArchives[file], digest)
  if (!result.success) {
    assert.deepEqual(await snapshot(`${label}-after`), before, `${label}: index changed on refusal`)
    const added = Object.keys(afterArchives).filter((file) => !Object.hasOwn(archives, file))
    assert.equal(added.length, 1, `${label}: failed original retention differs`)
    assert.equal(path.basename(added[0]), 'original.xls')
    assert.equal(afterArchives[added[0]], await hash(path.join(evidence, 'inputs', file)))
    item.retainedFailedOriginal = added[0]
  }
  save()
  return result
}
console.log(`Evidence: ${evidence}`)
try {
  const prepared = await runPython('fixtures')
  assert.equal(await prepared.completion, 0)
  await launch()
  // Establish a nonempty acknowledged index without invoking any model.
  const keep = await page.evaluate((request) => window.electronAPI.ingestFile(request), {
    filePath: path.join(evidence, 'inputs/keep.md'),
    normalizeWithLlm: false,
    taskId: randomUUID(),
  })
  assert.equal(keep.success, true, keep.error)
  assert.equal(keep.data.usedFallbackEmbeddings, true)
  report.baseline = keep
  await ingest('small', 'small.xls', { contains: ['Sheet0'] })
  await ingest('sparse', 'sparse.xls', { contains: ['65536', 'Col 256', 'Estratto RAG'] })
  await ingest('strings', 'strings.xls', { contains: ['Text0', 'Text1', '2 fogli su 12', 'Celle abbreviate'], excludes: ['Text2'] })
  await ingest('dense-admission', 'dense.xls', { full: false, error: /8 MiB/ })
  await ingest('dense-memory', 'dense.xls', { error: /memory.*budget|budget.*memory/i })
  await ingest('shared-memory', 'shared.xls', { error: /memory.*budget|budget.*memory/i })
  await ingest('job-admission', 'small.xls', { action: 'admission-refusal', error: /containment.*could not be established/i })
  await ingest('after-admission', 'small.xls')
  await ingest('timeout', 'dense.xls', { action: 'timeout', error: /60.*second.*time budget/i })
  await ingest('after-timeout', 'small.xls')
  await ingest('owner-crash', 'dense.xls', { action: 'owner-crash' })
  await ingest('after-owner-crash', 'small.xls')
  const beforeRestart = await snapshot('restart-before')
  await application.close()
  application = undefined
  sheets = 10
  await launch()
  assert.deepEqual(await snapshot('restart-after'), beforeRestart)
  await ingest('output-overflow', 'overflow.xls', { error: /32 MiB.*output|output.*32 MiB/i })
  await ingest('after-overflow', 'small.xls')
  for (const fixture of JSON.parse(fs.readFileSync(path.join(evidence, 'fixtures.json'), 'utf8')))
    assert.equal(await hash(path.join(evidence, 'inputs', fixture.name)), fixture.sha256)
  report.finalIndex = await snapshot('final')
  report.finalArchives = await archiveHashes()
  report.complete = true
} catch (error) {
  report.error = error.stack || String(error)
  process.exitCode = 1
} finally {
  if (observer) {
    // Only the label owned by this harness can be active.
    const argumentsText = observer.child.spawnargs
    const label = argumentsText[argumentsText.indexOf('--label') + 1]
    fs.writeFileSync(path.join(evidence, `${label}.stop`), '')
    await observer.completion
  }
  if (application) await application.close()
  save()
}
