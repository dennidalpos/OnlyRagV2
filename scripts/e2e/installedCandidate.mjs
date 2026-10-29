import '../retiredModelCampaign.mjs'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { _electron as electron } from 'playwright'

const executablePath = process.env.ONLYRAG_QUALIFICATION_EXE
const evidence = process.env.ONLYRAG_QUALIFICATION_EVIDENCE
const corpusDirectory = process.env.ONLYRAG_QUALIFICATION_CORPUS
assert(executablePath && path.isAbsolute(executablePath) && fs.existsSync(executablePath), 'An explicitly selected installed EXE is required')
assert(evidence && path.isAbsolute(evidence) && !fs.existsSync(evidence), 'A new absolute evidence directory is required')
assert(corpusDirectory && fs.existsSync(path.join(corpusDirectory, 'corpus.json')), 'Retained frozen corpus is required')
const occupied = await new Promise((resolve) => {
  const probe = net.connect({ host: '127.0.0.1', port: 8000 })
  probe.once('connect', () => {
    probe.destroy()
    resolve(true)
  })
  probe.once('error', () => {
    probe.destroy()
    resolve(false)
  })
})
assert.equal(occupied, false, 'Port 8000 is occupied; preserve its owner and refuse this campaign')
fs.mkdirSync(evidence, { recursive: true })
const userData = path.join(evidence, 'profile')
fs.mkdirSync(userData)
fs.writeFileSync(
  path.join(userData, 'settings.json'),
  JSON.stringify({
    version: 2,
    settings: {
      language: 'en',
      hasCompletedInitialSetup: true,
      ollamaHost: 'http://127.0.0.1:11434',
      defaultModel: 'qwen3.5:9b',
      embeddingModel: 'nomic-embed-text:latest',
      autoInstallHubSkills: 'disabled',
    },
  }),
)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ONLYRAG_E2E_TEST
delete env.ONLYRAG_E2E_USER_DATA
delete env.ONLYRAG_SMOKE_TEST
const report = { executablePath, userData, sourceHashes: {}, startup: [], documents: [], complete: false }
const save = () => fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2))
let application
async function launch() {
  application = await electron.launch({ executablePath, args: [`--user-data-dir=${userData}`, '--disable-gpu'], env, timeout: 60000 })
  const actual = await application.evaluate(({ app }) => ({
    userData: app.getPath('userData'),
    packaged: app.isPackaged,
    testMode: process.env.ONLYRAG_E2E_TEST || null,
  }))
  assert.equal(path.resolve(actual.userData), path.resolve(userData))
  assert.equal(actual.packaged, true)
  assert.equal(actual.testMode, null)
  const page = await application.firstWindow()
  await page.waitForFunction(() => !!window.electronAPI?.getIngestedDocuments)
  const deadline = Date.now() + 60000
  let documents
  while (Date.now() < deadline) {
    try {
      documents = await page.evaluate(() => window.electronAPI.getIngestedDocuments())
      if (Array.isArray(documents) && fs.existsSync(path.join(userData, 'sidecar-ownership.json'))) break
    } catch {
      /* Readiness is not acknowledged yet; keep the original deadline. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert(Array.isArray(documents), 'Automatic packaged Sidecar startup failed')
  const marker = JSON.parse(fs.readFileSync(path.join(userData, 'sidecar-ownership.json'), 'utf8'))
  report.startup.push({ ...actual, marker, count: documents.length })
  save()
  return page
}
try {
  let page = await launch()
  const corpus = JSON.parse(fs.readFileSync(path.join(corpusDirectory, 'corpus.json'), 'utf8'))
  for (const document of corpus.documents) {
    const source = path.join(corpusDirectory, `${document.id}.${document.format}`)
    const hash = createHash('sha256').update(fs.readFileSync(source)).digest('hex')
    const result = await page.evaluate((payload) => window.electronAPI.ingestFile(payload), { filePath: source, normalizeWithLlm: false, taskId: randomUUID() })
    assert.equal(result.success, true, `${document.id}: ${result.error}`)
    assert(result.data?.id)
    assert.equal(result.data.usedFallbackEmbeddings, false, 'The installed campaign requires actual local embeddings')
    for (const required of document.required_extraction) assert(result.data.extractedMarkdown.includes(required), `${document.id}: missing ${required}`)
    assert.equal(createHash('sha256').update(fs.readFileSync(source)).digest('hex'), hash)
    report.sourceHashes[source] = hash
    report.documents.push({ corpusId: document.id, document: result.data })
    save()
  }
  const before = await page.evaluate(() => window.electronAPI.getIngestedDocuments())
  assert.equal(before.length, corpus.documents.length)
  await application.close()
  application = undefined
  page = await launch()
  const after = await page.evaluate(() => window.electronAPI.getIngestedDocuments())
  assert.deepEqual(after.map((document) => document.id).sort(), before.map((document) => document.id).sort())
  report.complete = true
  save()
  console.log(`[PASS] Installed automatic Sidecar startup, ${after.length} real-encoder document ingestions and restart readback; evidence ${evidence}`)
} catch (error) {
  report.error = String(error)
  save()
  throw error
} finally {
  if (application) await application.close()
}
