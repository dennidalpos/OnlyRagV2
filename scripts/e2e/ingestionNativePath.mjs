import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-native-ingestion-'))
const userData = path.join(tempRoot, 'user-data')
const selections = ['first', 'second'].map((name) => ({ filePath: path.join(tempRoot, name, 'report.md'), content: `# ${name} native source\n` }))
const received = []
let application
let fixtureError

// A local transport fixture reads the real source; it refuses indexing after recording identity.
const server = http.createServer(async (request, response) => {
  try {
    if (request.url === '/ingest-path-stream') {
      let body = ''
      for await (const chunk of request) body += chunk
      const payload = JSON.parse(body)
      assert(
        selections.some((item) => item.filePath === payload.file_path),
        'Unexpected source path reached the fixture',
      )
      received.push({ filePath: payload.file_path, content: fs.readFileSync(payload.file_path, 'utf8') })
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      response.end(JSON.stringify({ type: 'error', task_id: payload.task_id, error: `Native path verified ${received.length}` }) + '\n')
    } else if (request.url === '/documents') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end('[]')
    } else {
      response.writeHead(503, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ detail: 'Isolated native-path fixture; model services unavailable' }))
    }
  } catch (error) {
    fixtureError = error
    response.writeHead(500)
    response.end('Native-path fixture failed')
  }
})

try {
  fs.mkdirSync(userData)
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ version: 2, settings: { language: 'en', hasCompletedInitialSetup: true } }))
  for (const selection of selections) {
    fs.mkdirSync(path.dirname(selection.filePath))
    fs.writeFileSync(selection.filePath, selection.content)
  }
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  const bootstrap = path.join(tempRoot, 'bootstrap.cjs')
  // Redirect only Sidecar transport. Production sender/schema/filesystem handlers stay installed.
  fs.writeFileSync(
    bootstrap,
    `
const http = require('node:http')
const request = http.request
http.request = function (options, ...rest) {
  if (options && typeof options === 'object' && options.hostname === '127.0.0.1' && Number(options.port) === 8000) {
    return request.call(this, { ...options, port: ${port} }, ...rest)
  }
  return request.call(this, options, ...rest)
}
require(${JSON.stringify(path.join(root, 'dist-electron', 'main.js'))})
`,
  )
  application = await electron.launch({
    executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [bootstrap, '--disable-gpu'],
    cwd: root,
    env: { ...process.env, ONLYRAG_E2E_TEST: '1', ONLYRAG_E2E_USER_DATA: userData, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
    timeout: 30_000,
  })
  const page = await application.firstWindow()
  await page.locator('#tab-ingestion').click()
  const input = page.locator('#panel-ingestion input[type="file"]')
  await input.waitFor({ state: 'attached' })
  const upload = page.locator('#panel-ingestion').getByRole('button', { name: 'Browse Files to Upload', exact: true })

  const verifyReceived = async (selection) => {
    await page.getByText(`Native path verified ${received.length || 1}`, { exact: true }).waitFor({ timeout: 10_000 })
    if (fixtureError) throw fixtureError
    assert.deepEqual(received.at(-1), selection)
    await upload.waitFor({ state: 'visible' })
    assert(await upload.isEnabled(), 'Upload ownership was not released')
  }

  // Playwright supplies disk-backed DOM Files; DataTransfer preserves those exact native Files.
  await page.evaluate(() => {
    const source = document.createElement('input')
    source.type = 'file'
    source.id = 'native-drop-source'
    document.body.append(source)
  })
  for (const selection of selections) {
    const beforeInput = received.length
    await input.setInputFiles(selection.filePath)
    await page.getByText(`Native path verified ${beforeInput + 1}`, { exact: true }).waitFor()
    await verifyReceived(selection)

    const source = page.locator('#native-drop-source')
    await source.setInputFiles(selection.filePath)
    assert.equal(await source.evaluate((element) => window.electronAPI.resolveNativeFilePath({ file: element.files[0] })), selection.filePath)
    const beforeDrop = received.length
    await source.evaluate((element) => {
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(element.files[0])
      document.querySelector('#panel-ingestion input[type="file"]').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }))
    })
    await page.getByText(`Native path verified ${beforeDrop + 1}`, { exact: true }).waitFor()
    await verifyReceived(selection)

    // Control the OS chooser result; the real dialog IPC, shell adapter and ingestion handler run.
    await application.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
    }, selection.filePath)
    const beforeDialog = received.length
    await upload.click()
    await page.getByText(`Native path verified ${beforeDialog + 1}`, { exact: true }).waitFor()
    await verifyReceived(selection)
  }
  assert.equal(received.length, 6)

  const missingPath = 'This file has no local disk path. Select a file saved on this device.'
  for (const type of ['change', 'drop']) {
    assert.equal(
      await page.evaluate((eventType) => {
        const file = new File(['synthetic content'], 'report.md')
        const nativePath = window.electronAPI.resolveNativeFilePath({ file })
        const dataTransfer = new DataTransfer()
        dataTransfer.items.add(file)
        const target = document.querySelector('#panel-ingestion input[type="file"]')
        if (eventType === 'change') {
          target.files = dataTransfer.files
          target.dispatchEvent(new Event('change', { bubbles: true }))
        } else {
          target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }))
        }
        return nativePath
      }, type),
      '',
    )
    await page.getByText(missingPath, { exact: true }).waitFor()
    assert.equal(received.length, 6, 'Synthetic File reached Main ingestion transport')
  }
  assert(
    await page.evaluate(() => {
      try {
        window.electronAPI.resolveNativeFilePath({ file: { name: 'report.md' } })
        return false
      } catch {
        return true
      }
    }),
    'Non-File input did not throw',
  )
  const absent = await page.evaluate((filePath) => window.electronAPI.ingestFile({ filePath, taskId: 'native-path-absent' }), path.join(tempRoot, 'absent.md'))
  assert.equal(absent.success, false)
  assert.equal(absent.error, 'File does not exist on disk')
  assert(
    await page.evaluate(async () => {
      try {
        await window.electronAPI.ingestFile({ filePath: ' ', taskId: 'native-path-empty' })
        return false
      } catch {
        return true
      }
    }),
    'Main IPC accepted an empty path',
  )
  assert.equal(received.length, 6, 'Main refusal reached the transport fixture')
  if (fixtureError) throw fixtureError
  console.log(
    '[PASS] Electron: 6 native input/drop/dialog paths preserve both same-named sources; 2 synthetic Files, non-File, absent-file and IPC empty-path refusals verified. No indexing/model qualification.',
  )
} finally {
  try {
    if (application) await application.close()
  } finally {
    try {
      if (server.listening) await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    } finally {
      assert.equal(path.dirname(path.resolve(tempRoot)), path.resolve(os.tmpdir()))
      assert(path.basename(tempRoot).startsWith('onlyrag-native-ingestion-'), 'Refusing unexpected cleanup target')
      fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    }
  }
}
