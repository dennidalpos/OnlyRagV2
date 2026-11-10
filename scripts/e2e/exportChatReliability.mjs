import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-export-chat-'))
const userData = path.join(scratch, 'user-data')
const output = path.join(scratch, 'exports')
const python = path.join(root, '.venv/Scripts/python.exe')
const token = randomUUID()
let application
let complete = false
let sidecarLog = ''
let port
for (const folder of [userData, output]) fs.mkdirSync(folder)
fs.writeFileSync(
  path.join(userData, 'settings.json'),
  JSON.stringify({
    version: 2,
    settings: {
      language: 'en',
      hasCompletedInitialSetup: true,
      defaultModel: 'general-fixture',
      medicalModel: 'medical-fixture',
      legalModel: 'legal-fixture',
      modelContextLengths: { 'general-fixture': 4096, 'medical-fixture': 2048, 'legal-fixture': 8192 },
      // All incidental model diagnostics are refused on an unused loopback port.
      ollamaHost: 'http://127.0.0.1:1',
    },
  }),
)
// Actual authenticated Sidecar on an owned random port/store. No startup maintenance or model calls.
const child = spawn(
  python,
  [
    '-u',
    '-c',
    [
      'import socket, uvicorn',
      'sock = socket.socket(); sock.bind(("127.0.0.1", 0)); sock.listen(128)',
      'print("EXPORT_PORT=" + str(sock.getsockname()[1]), flush=True)',
      'from sidecar.main import app',
      'uvicorn.Server(uvicorn.Config(app, log_level="warning", access_log=False, lifespan="off")).run(sockets=[sock])',
    ].join('\n'),
  ],
  {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, ONLYRAG_DATA_DIR: path.join(scratch, 'sidecar'), ONLYRAG_SIDECAR_TOKEN: token, OLLAMA_BASE_URL: 'http://127.0.0.1:1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)
child.stdout.on('data', (chunk) => {
  sidecarLog += chunk
  const match = sidecarLog.match(/EXPORT_PORT=(\d+)/)
  if (match) port = Number(match[1])
})
child.stderr.on('data', (chunk) => {
  sidecarLog += chunk
})
child.on('error', (error) => {
  sidecarLog += error.message
})

try {
  const deadline = Date.now() + 30_000
  let ready = false
  while (Date.now() < deadline && child.exitCode === null) {
    if (port) {
      try {
        ready = (await fetch(`http://127.0.0.1:${port}/openapi.json`, { headers: { 'X-OnlyRag-Token': token }, signal: AbortSignal.timeout(1000) })).ok
      } catch {
        /* Await only the owned Sidecar. */
      }
    }
    if (ready) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert(ready, `Isolated Sidecar failed startup: ${sidecarLog}`)
  const bootstrap = path.join(scratch, 'bootstrap.cjs')
  fs.writeFileSync(
    bootstrap,
    `
const http = require('node:http')
const request = http.request
globalThis.__exportRequests = 0
http.request = function (options, ...rest) {
  if (options && options.hostname === '127.0.0.1' && Number(options.port) === 8000) {
    if (options.path === '/export') globalThis.__exportRequests++
    return request.call(this, { ...options, port: ${port}, headers: { ...options.headers, 'X-OnlyRag-Token': ${JSON.stringify(token)} } }, ...rest)
  }
  return request.call(this, options, ...rest)
}
require(${JSON.stringify(path.join(root, 'dist-electron/main.js'))})
`,
  )
  const environment = { ...process.env, ONLYRAG_E2E_TEST: '1', ONLYRAG_E2E_USER_DATA: userData, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
  delete environment.ELECTRON_RUN_AS_NODE
  application = await electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [bootstrap, '--disable-gpu'],
    cwd: root,
    env: environment,
  })
  await application.evaluate(({ ipcMain, shell }) => {
    globalThis.__revealed = []
    shell.showItemInFolder = (file) => {
      globalThis.__revealed.push(file)
    }
    // Model transport only is simulated; chat budget, persistence, export handlers and Preload are real.
    ipcMain.removeHandler('ollama:get-model-metrics')
    ipcMain.handle('ollama:get-model-metrics', () => ({ 'legal-fixture': { contextLength: 3072, capabilities: ['completion'] } }))
    ipcMain.removeHandler('ollama:generate-stream')
    globalThis.__chatRequests = []
    ipcMain.handle('ollama:generate-stream', async (event, request) => {
      globalThis.__chatRequests.push(request)
      event.sender.send('ollama:chunk', { operationId: request.operationId, chunk: `Offline answer ${request.model}` })
      // Let Renderer receive the stream event before the invoke result retires its listeners.
      await new Promise((resolve) => setTimeout(resolve, 50))
      return { success: true }
    })
  })
  const page = await application.firstWindow()
  await page.reload()
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.waitForFunction(() => Boolean(window.electronAPI && window.__onlyragFlushSettings))
  const results = []
  for (const format of ['md', 'pdf', 'docx', 'html', 'htm']) {
    const exports = await page.evaluate(
      async ({ format, output }) =>
        Promise.all(
          [1, 2].map((i) =>
            window.electronAPI.exportDocument({
              markdownContent: `# Document ${i}\n\n</pre><script>inert marker</script> & città 漢 😀\n\n\x60\x60\x60python\nvaluable_code_${i} = 42`,
              format,
              outputFolder: output,
            }),
          ),
        ),
      { format, output },
    )
    for (const [i, result] of exports.entries()) {
      assert.equal(result.success, true, JSON.stringify(result))
      const file = result.filePath
      results.push(file)
      assert(fs.statSync(file).size > 0)
      if (format === 'html' || format === 'htm') {
        const text = fs.readFileSync(file, 'utf8')
        assert(!text.includes('<script>'))
        assert(text.includes('&lt;script&gt;'))
        assert(text.includes(`valuable_code_${i + 1}`))
      } else if (format === 'md') assert(fs.readFileSync(file, 'utf8').includes(`valuable_code_${i + 1}`))
      else {
        const text = execFileSync(
          python,
          [
            '-X',
            'utf8',
            '-c',
            format === 'pdf'
              ? 'import pymupdf,sys; d=pymupdf.open(sys.argv[1]); print("".join(p.get_text() for p in d))'
              : 'import docx,sys; print("\\n".join(p.text for p in docx.Document(sys.argv[1]).paragraphs))',
            file,
          ],
          { encoding: 'utf8', windowsHide: true },
        )
        assert(text.includes(`valuable_code_${i + 1}`))
      }
    }
  }
  assert.equal(new Set(results).size, 10)
  // Production IPC refuses conversion before any Sidecar request, while literal Markdown remains a recovery path.
  const beforeLargeExport = await application.evaluate(() => globalThis.__exportRequests)
  const previousBytes = results.map((file) => fs.readFileSync(file))
  const largeRecovery = await page.evaluate(async (output) => {
    const text = '😀'.repeat(5_000_001) + '\nLAST_SOURCE_LINE'
    const refused = []
    for (const format of ['pdf', 'docx', 'html', 'htm']) {
      try {
        await window.electronAPI.exportDocument({ markdownContent: text, format, outputFolder: output })
        refused.push(false)
      } catch {
        refused.push(true)
      }
    }
    return { refused, recovered: await window.electronAPI.exportDocument({ markdownContent: text, format: 'md', outputFolder: output }) }
  }, output)
  assert(largeRecovery.refused.every(Boolean))
  assert.equal(largeRecovery.recovered.success, true)
  assert.equal(await application.evaluate(() => globalThis.__exportRequests), beforeLargeExport)
  const largeText = '😀'.repeat(5_000_001) + '\nLAST_SOURCE_LINE'
  assert.equal(fs.statSync(largeRecovery.recovered.filePath).size, Buffer.byteLength(largeText))
  assert.equal(
    createHash('sha256').update(fs.readFileSync(largeRecovery.recovered.filePath)).digest('hex'),
    createHash('sha256').update(largeText).digest('hex'),
  )
  results.forEach((file, i) => assert(fs.readFileSync(file).equals(previousBytes[i])))
  const chosen = path.join(output, 'chosen.md')
  fs.writeFileSync(chosen, 'Previous export')
  await application.evaluate(({ dialog }, chosen) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: chosen })
  }, chosen)
  assert.equal((await page.evaluate(() => window.electronAPI.exportDocument({ markdownContent: 'Chosen replacement', format: 'md' }))).success, true)
  assert.equal(fs.readFileSync(chosen, 'utf8'), 'Chosen replacement')
  await application.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true })
  })
  const beforeCancel = await application.evaluate(() => globalThis.__exportRequests)
  assert.equal((await page.evaluate(() => window.electronAPI.exportDocument({ markdownContent: 'Cancelled', format: 'pdf' }))).success, false)
  assert.equal(await application.evaluate(() => globalThis.__exportRequests), beforeCancel)
  const reveals = await application.evaluate(() => globalThis.__revealed.length)
  await application.evaluate(({ dialog }, output) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: output })
  }, output)
  assert.equal((await page.evaluate(() => window.electronAPI.exportDocument({ markdownContent: 'Refused', format: 'md' }))).success, false)
  assert.equal(await application.evaluate(() => globalThis.__revealed.length), reveals)
  assert.equal(fs.readFileSync(chosen, 'utf8'), 'Chosen replacement')

  await page.getByRole('tab', { name: 'RAG & Chat', exact: true }).click()
  for (const [query, model, windowSize] of [
    ['Antibiotic therapy for pneumonia', 'medical-fixture', 2048],
    ['Contratto clausola risarcimento tribunale', 'legal-fixture', 3072],
    ['Describe a sunset', 'general-fixture', 4096],
  ]) {
    const input = page.getByRole('textbox', { name: /^Ask your documents/ })
    await input.fill(query)
    await input.press('Enter')
    await page.getByText(`Offline answer ${model}`, { exact: true }).waitFor()
    const request = await application.evaluate(() => globalThis.__chatRequests.at(-1))
    assert.equal(request.model, model)
    assert.equal(request.options.num_ctx, windowSize)
  }
  assert.equal(await page.evaluate(() => window.__onlyragFlushChat()), true)
  await application.close()
  application = undefined
  complete = true
  console.log(
    '[PASS] Real Main/Preload/Sidecar: 10 distinct exports, literal HTML, PDF/DOCX code readback, oversized Unicode Markdown recovery with SHA-256 readback and refused conversions, explicit replacement, cancellation/refusal; desktop chat routes 3 models with their own context. No real-model calls.',
  )
} finally {
  if (application) await application.close()
  if (child.exitCode === null) {
    await new Promise((resolve) => {
      child.once('exit', resolve)
      child.kill()
    })
  }
  if (complete) {
    assert.equal(path.dirname(path.resolve(scratch)), path.resolve(os.tmpdir()))
    assert(path.basename(scratch).startsWith('onlyrag-export-chat-'))
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  } else {
    fs.writeFileSync(path.join(scratch, 'sidecar.log'), sidecarLog)
    console.error(`Retained failed export/chat fixture: ${scratch}`)
  }
}
