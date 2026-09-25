import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

/**
 * Ingests and translates a real PDF through the UI of the built app, with the dev Sidecar
 * (.venv) and the local Ollama. The other E2E scripts run with the Sidecar off, so they never
 * see its startup ownership check or the payloads the ingestion and translation views send.
 * Models and host come from the real settings.json, like the live runs.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-ingest-translate-'))
const userData = path.join(tempRoot, 'user-data')
const outputDir = path.join(tempRoot, 'translated')
const screenshotDir = process.env.ONLYRAG_E2E_SCREENSHOT_DIR || path.join(tempRoot, 'screenshots')
fs.mkdirSync(userData)
fs.mkdirSync(outputDir)
fs.mkdirSync(screenshotDir, { recursive: true })

const realSettingsPath = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'onlyrag-v2', 'settings.json')
const realSettings = fs.existsSync(realSettingsPath) ? JSON.parse(fs.readFileSync(realSettingsPath, 'utf8')) : {}
const real = realSettings.settings ?? realSettings
fs.writeFileSync(
  path.join(userData, 'settings.json'),
  JSON.stringify({
    version: 2,
    settings: {
      ollamaHost: real.ollamaHost || 'http://127.0.0.1:11434',
      language: 'it',
      ocrEngine: real.ocrEngine || 'native_cuda',
      embeddingModel: real.embeddingModel || 'nomic-embed-text:latest',
      visionModel: real.visionModel || 'moondream:latest',
      translationModel: real.translationModel || 'qwen2.5:3b',
      defaultModel: real.defaultModel || real.translationModel || 'qwen2.5:3b',
      translationOutputFolder: outputDir,
      hasCompletedInitialSetup: true,
    },
  }),
)

const PAGES = 8
const pdfPath = path.join(tempRoot, 'e2e-doc.pdf')
execFileSync(path.join(root, '.venv', 'Scripts', 'python.exe'), [
  '-c',
  [
    'import pymupdf, sys',
    'd = pymupdf.open()',
    `for i in range(${PAGES}):`,
    '    p = d.new_page()',
    '    for j in range(12):',
    '        p.insert_text((72, 72 + j * 24), f"Pagina {i + 1}, paragrafo {j + 1}: questo documento verifica il progresso di ingestione e traduzione.", fontsize=11)',
    'd.save(sys.argv[1])',
  ].join('\n'),
  pdfPath,
])

/** Widths of the determinate progress bars, as the user sees them. */
const readBarWidths = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[style*="width"]')]
      .map((element) => element.style.width)
      .filter((width) => /^\d+(\.\d+)?%$/.test(width) && width !== '100%'),
  )

let application
try {
  application = await electron.launch({
    executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [path.join(root, 'dist-electron', 'main.js'), '--disable-gpu'],
    cwd: root,
    env: { ...process.env, ONLYRAG_E2E_TEST: '1', ONLYRAG_E2E_USER_DATA: userData, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
    timeout: 30_000,
  })
  const page = await application.firstWindow()
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.waitForLoadState('domcontentloaded')
  await application.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, pdfPath)

  // E2E mode leaves the Sidecar off; the restart IPC runs the same start path as a normal launch.
  const restart = await page.evaluate(() => window.electronAPI.restartSidecar())
  assert.equal(restart.success, true, `Sidecar did not start: ${JSON.stringify(restart)}`)

  await page.evaluate(() => {
    window.__ingest = []
    window.__translate = []
    window.electronAPI.onIngestStreamProgress((event) => window.__ingest.push(event))
    window.electronAPI.onTranslateProgress((event) => window.__translate.push(event))
  })

  await page.click('#tab-ingestion')
  await page.getByRole('button', { name: /Sfoglia File da Caricare/ }).click()
  await page.waitForFunction(() => window.__ingest.some((event) => event.type === 'done'), null, { timeout: 180_000 })
  const ingest = await page.evaluate(() => window.__ingest)
  assert.equal(await page.getByText('Invalid IPC payload').count(), 0, 'The ingestion view sent a payload Main rejects')
  const ingestPercents = ingest.filter((event) => event.type === 'progress').map((event) => event.percent)
  assert(ingestPercents.length >= PAGES, `Expected a progress event per page, got ${ingestPercents.length}`)
  assert.deepEqual(
    ingestPercents,
    [...ingestPercents].sort((a, b) => a - b),
    'Ingestion progress went backwards',
  )
  assert(
    ingest.every((event) => typeof event.taskId === 'string' && event.taskId.length > 0),
    'An ingestion event lacks its task id',
  )
  assert(!ingest.some((event) => 'data' in event), 'The done event relayed the document record')
  // Well inside the 10 s diagnostics poll: the sidebar count follows the ingestion, not the timer.
  await page.getByText('1 Docs', { exact: true }).waitFor({ timeout: 5_000 })
  await page.screenshot({ path: path.join(screenshotDir, 'ingested.png') })

  const documents = await page.evaluate(() => window.electronAPI.getIngestedDocuments())
  const document = documents?.find((doc) => doc.filename === 'e2e-doc.pdf')
  assert(document, 'The ingested PDF is not listed')
  assert.equal(document.numPages, PAGES)

  await page.click('#tab-translation')
  await page.getByRole('tab', { name: /Layout Preservato/ }).click()
  await page.selectOption('#inplace-doc-select', document.id)
  await page.getByRole('button', { name: /Avvia Traduzione/ }).click()
  const seenWidths = new Set()
  const deadline = Date.now() + 600_000
  while (Date.now() < deadline) {
    for (const width of await readBarWidths(page)) seenWidths.add(width)
    if (await page.getByText(/Documento tradotto con successo/).count()) break
    assert.equal(await page.getByText(/Errore/).count(), 0, 'Translation reported an error')
    await page.waitForTimeout(250)
  }
  await page.screenshot({ path: path.join(screenshotDir, 'translated.png') })
  const translate = await page.evaluate(() => window.__translate)
  const pageEvents = translate.filter((event) => typeof event.page === 'number')
  assert(pageEvents.length >= PAGES, `Expected translation events for each page, got ${pageEvents.length}`)
  assert.equal(Math.max(...pageEvents.map((event) => event.page)), PAGES)
  assert(seenWidths.size >= 2, `The translation bar did not advance: ${[...seenWidths].join(', ')}`)
  const outputs = fs.readdirSync(outputDir)
  assert(
    outputs.some((name) => name.endsWith('.pdf')),
    `No translated PDF in ${outputDir}`,
  )

  const appLog = fs.readFileSync(path.join(userData, 'logs', 'app.log'), 'utf8')
  assert(!/Dropped a malformed Sidecar progress event/.test(appLog), 'Main dropped Sidecar progress events')
  assert(!/Sidecar port was taken/.test(appLog), 'Main rejected its own Sidecar at startup')

  console.log(
    `[PASS] Dev Sidecar start, ingestion (${ingest.length} events) and layout translation (${translate.length} events, bar ${[...seenWidths].join(' ')}) of a ${PAGES}-page PDF.`,
  )
} finally {
  if (application) await application.close()
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
}
