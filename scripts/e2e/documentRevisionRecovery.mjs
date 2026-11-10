import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-document-revision-'))
const userData = path.join(scratch, 'user-data')
fs.mkdirSync(userData)
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ version: 2, settings: { language: 'en', hasCompletedInitialSetup: true } }))
const environment = { ...process.env, ONLYRAG_E2E_TEST: '1', ONLYRAG_E2E_USER_DATA: userData, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
delete environment.ELECTRON_RUN_AS_NODE
let application
let complete = false
try {
  application = await electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [path.join(root, 'dist-electron/main.js'), '--disable-gpu'],
    cwd: root,
    env: environment,
    timeout: 30_000,
  })
  // Deterministic document service fixture; real Renderer, Monaco, Main lifecycle and Preload.
  // The separate Python suite covers the actual REST/LanceDB conflict and rollback.
  await application.evaluate(({ ipcMain }) => {
    globalThis.__revisionDocument = {
      id: 'doc',
      filename: 'notes.md',
      filePath: 'notes.md',
      fileSize: 8,
      numPages: 1,
      numChunks: 1,
      status: 'indexed',
      ingestedAt: 't1',
      fileType: 'text',
      extractedMarkdown: '# Original',
    }
    globalThis.__revisionRequests = []
    for (const channel of ['ingest:list', 'ingest:get', 'ingest:update']) ipcMain.removeHandler(channel)
    ipcMain.handle('ingest:list', async () => [{ ...globalThis.__revisionDocument }])
    ipcMain.handle('ingest:get', async () => ({ ...globalThis.__revisionDocument }))
    ipcMain.handle('ingest:update', async (_event, request) => {
      globalThis.__revisionRequests.push(request)
      if (request.expectedRevision !== globalThis.__revisionDocument.ingestedAt)
        return { success: false, error: 'Document changed; reload before saving. Your draft has not been applied.' }
      globalThis.__revisionDocument = { ...globalThis.__revisionDocument, ingestedAt: 't3', extractedMarkdown: request.markdownContent }
      return { success: true, data: { ...globalThis.__revisionDocument } }
    })
  })
  const page = await application.firstWindow()
  await page.reload()
  const editor = page.locator('.monaco-editor .view-lines').first()
  await editor.waitFor()
  await page.waitForFunction(() => document.querySelector('.monaco-editor .view-lines')?.textContent?.includes('Original'))
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('# My draft')
  await application.evaluate(() => {
    globalThis.__revisionDocument = { ...globalThis.__revisionDocument, ingestedAt: 't2', extractedMarkdown: '# External winner' }
  })
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click()
  const banner = page.getByRole('alert').filter({ hasText: 'Document changed' })
  await banner.waitFor({ timeout: 5000 }).catch(async (error) => {
    await page.screenshot({ path: path.join(scratch, 'failure.png') })
    console.error('Revision probe state:', await application.evaluate(() => globalThis.__revisionRequests))
    console.error('Visible page:', (await page.locator('body').innerText()).slice(-3000))
    throw error
  })
  const rejected = await application.evaluate(() => ({ request: globalThis.__revisionRequests[0], stored: globalThis.__revisionDocument.extractedMarkdown }))
  assert.equal(rejected.request.expectedRevision, 't1')
  assert.equal(rejected.request.markdownContent, '# My draft')
  assert.equal(rejected.stored, '# External winner')
  const screenshots = path.join(root, 'test-results', `flow-contracts-${Date.now()}`)
  fs.mkdirSync(screenshots, { recursive: true })
  for (const [label, width, height] of [
    ['desktop', 1920, 1080],
    ['tablet', 768, 1024],
    ['phone', 390, 844],
  ]) {
    await page.setViewportSize({ width, height })
    const bounds = await banner.boundingBox()
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `${label}: conflict banner outside viewport`)
    await page.screenshot({ path: path.join(screenshots, `${label}.png`) })
  }
  await page.setViewportSize({ width: 1920, height: 1080 })
  await banner.getByRole('button', { name: 'Discard draft and reload notes.md', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm — notes.md', exact: true }).click()
  await banner.waitFor({ state: 'detached' })
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('# New edit after reload')
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Changes saved and LanceDB' }).waitFor()
  const accepted = await application.evaluate(() => ({
    request: globalThis.__revisionRequests.at(-1),
    stored: globalThis.__revisionDocument.extractedMarkdown,
  }))
  assert.equal(accepted.request.expectedRevision, 't2')
  assert.equal(accepted.stored, '# New edit after reload')
  complete = true
  console.log(
    `[PASS] Stale draft retained, explicit reload and subsequent save use the correct revisions; conflict banner fits desktop/tablet/phone. Screenshots: ${screenshots}`,
  )
} finally {
  if (application) await application.close()
  if (complete) {
    assert.equal(path.dirname(path.resolve(scratch)), path.resolve(os.tmpdir()))
    assert(path.basename(scratch).startsWith('onlyrag-document-revision-'))
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  } else console.error(`Retained failed document-revision fixture: ${scratch}`)
}
