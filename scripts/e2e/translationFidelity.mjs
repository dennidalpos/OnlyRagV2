import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const evidence = path.join(
  process.env.ONLYRAG_LIVE_ROOT || path.join(os.homedir(), 'OnlyRag-Live'),
  `translation-fidelity-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`,
)
fs.mkdirSync(evidence, { recursive: true })
console.log(`Evidence: ${evidence}`)
const report = { complete: false, cases: [], semantic_review: null, source_sha256: {} }
const save = () => fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n')
for (const file of ['sidecar/domain/translator.py', 'scripts/e2e/translationFidelity.mjs', 'scripts/live/translationFidelityCorpus.py']) {
  report.source_sha256[file] = createHash('sha256')
    .update(fs.readFileSync(path.join(root, file)))
    .digest('hex')
}
const python = path.join(root, '.venv', 'Scripts', 'python.exe')
const corpusHelper = path.join(root, 'scripts', 'live', 'translationFidelityCorpus.py')
const userData = path.join(evidence, 'isolated-profile')
const outputDir = path.join(evidence, 'outputs')
let application
try {
  // Abort before launching: never reclaim an existing user's Sidecar.
  await new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(8000, '127.0.0.1', () => probe.close(resolve))
  })
  const host = 'http://127.0.0.1:11434'
  const model = 'qwen3.5:9b'
  const version = await fetch(`${host}/api/version`).then((response) => {
    assert(response.ok, 'Local Ollama version unavailable')
    return response.json()
  })
  const tags = await fetch(`${host}/api/tags`).then((response) => {
    assert(response.ok, 'Local Ollama models unavailable')
    return response.json()
  })
  const installed = tags.models.find((item) => item.name === model)
  assert(installed, 'Approved local 9B model must already be installed')
  report.runtime = { version, model: installed, requested_context: 8192, thinking: false }
  execFileSync(python, [corpusHelper, 'prepare', evidence], { cwd: root, windowsHide: true })
  const manifest = JSON.parse(fs.readFileSync(path.join(evidence, 'manifest.json'), 'utf8'))
  report.corpus_sha256 = manifest.corpus_sha256
  fs.mkdirSync(userData)
  fs.mkdirSync(outputDir)
  fs.writeFileSync(
    path.join(userData, 'settings.json'),
    JSON.stringify({
      version: 2,
      settings: {
        ollamaHost: host,
        language: 'en',
        ocrEngine: 'native_cuda',
        embeddingModel: 'nomic-embed-text:latest',
        translationModel: model,
        defaultModel: model,
        modelContextLengths: { [model]: 8192 },
        modelThinkingPreferences: { [model]: false },
        translationOutputFolder: outputDir,
        hasCompletedInitialSetup: true,
      },
    }),
  )
  application = await electron.launch({
    executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [path.join(root, 'dist-electron', 'main.js'), '--disable-gpu'],
    cwd: root,
    env: { ...process.env, ONLYRAG_E2E_TEST: '1', ONLYRAG_E2E_USER_DATA: userData, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
    timeout: 30_000,
  })
  const page = await application.firstWindow()
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.waitForFunction(() => Boolean(window.electronAPI))
  const restarted = await page.evaluate(() => window.electronAPI.restartSidecar())
  assert.equal(restarted.success, true, `Isolated Sidecar startup failed: ${JSON.stringify(restarted)}`)
  await page.evaluate(() => {
    window.__fidelityIngest = []
    window.__fidelityTranslate = []
    window.electronAPI.onIngestStreamProgress((event) => window.__fidelityIngest.push(event))
    window.electronAPI.onTranslateProgress((event) => window.__fidelityTranslate.push(event))
  })
  for (const item of manifest.cases) {
    await page.evaluate(() => {
      window.__fidelityIngest = []
      window.__fidelityTranslate = []
    })
    // Only the OS file picker is substituted; ingestion and generation use real IPC/REST.
    await application.evaluate(({ dialog }, source) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] })
    }, item.source)
    await page.click('#tab-ingestion')
    await page.getByRole('button', { name: /Browse Files to Upload/ }).click()
    await page.waitForFunction(() => window.__fidelityIngest.some((event) => ['done', 'error'].includes(event.type)), null, { timeout: 180_000 })
    const ingest = await page.evaluate(() => window.__fidelityIngest)
    assert(
      ingest.some((event) => event.type === 'done'),
      `Ingestion failed: ${JSON.stringify(ingest)}`,
    )
    const documents = await page.evaluate(() => window.electronAPI.getIngestedDocuments())
    const document = documents.find((doc) => doc.filename === path.basename(item.source))
    assert(document, `Missing ingested document: ${item.id}`)
    const extracted = await page.evaluate((docId) => window.electronAPI.getIngestedDocument({ docId }), document.id)
    await page.click('#tab-translation')
    await page.getByRole('tab', { name: /Layout-Preserving/ }).click()
    await page.selectOption('#inplace-doc-select', document.id)
    await page.selectOption('#inplace-source-lang', item.source_lang)
    await page.selectOption('#inplace-target-lang', item.target_lang)
    const previous = new Set(fs.readdirSync(outputDir))
    const started = Date.now()
    await page.getByRole('button', { name: /Start Layout-Preserving Translation/ }).click()
    await page.waitForFunction(() => window.__fidelityTranslate.some((event) => ['done', 'error', 'cancelled'].includes(event.type)), null, {
      timeout: 300_000,
    })
    const events = await page.evaluate(() => window.__fidelityTranslate)
    assert(
      events.some((event) => event.type === 'done'),
      `Translation failed: ${JSON.stringify(events)}`,
    )
    await page.getByText(/Document translated successfully/).waitFor()
    const outputs = fs.readdirSync(outputDir).filter((name) => !previous.has(name))
    assert.equal(outputs.length, 1, 'Exactly one new output is required')
    report.cases.push({
      ...item,
      document_id: document.id,
      extracted,
      ingest,
      events,
      elapsed_ms: Date.now() - started,
      output: path.join(outputDir, outputs[0]),
    })
    save()
    await page.screenshot({ path: path.join(evidence, `${item.id}-desktop.png`) })
    console.log(`[CAPTURED] ${item.id}`)
  }
  execFileSync(python, [corpusHelper, 'readback', evidence], { cwd: root, windowsHide: true })
  Object.assign(report, JSON.parse(fs.readFileSync(path.join(evidence, 'report.json'), 'utf8')))
  report.complete = true
  console.log(`[PASS] ${report.cases.length} desktop captures; independent semantic review still required.`)
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error)
  throw error
} finally {
  save()
  if (application) await application.close()
}
