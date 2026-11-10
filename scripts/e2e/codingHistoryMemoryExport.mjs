import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { _electron as electron } from 'playwright'
import { build } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-memory-export-'))
const userData = path.join(scratch, 'user-data')
const workspace = path.join(scratch, 'workspace with spaces')
const destination = path.join(scratch, 'export with spaces')
const historyFile = path.join(workspace, '.onlyrag', 'sessions', 'history.json')
const recoveryRoot = path.join(userData, 'sessions', 'history-recovery')
for (const directory of [userData, workspace, destination]) fs.mkdirSync(directory, { recursive: true })
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ version: 2, settings: { language: 'en', hasCompletedInitialSetup: true } }))

let application
let complete = false
try {
  const built = await build({
    configFile: false,
    root,
    plugins: [react()],
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      write: false,
      minify: false,
      lib: { entry: path.join(root, 'scripts/e2e/codingHistoryMemoryExportFixture.tsx'), name: 'MemoryExportFixture', formats: ['iife'] },
    },
  })
  const javascript = (Array.isArray(built) ? built : [built])
    .flatMap((item) => item.output)
    .filter((item) => item.type === 'chunk')
    .map((item) => item.code)
    .join('\n')
  const environment = { ...process.env, ONLYRAG_E2E_TEST: '1', ONLYRAG_E2E_USER_DATA: userData, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
  delete environment.ELECTRON_RUN_AS_NODE
  application = await electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [path.join(root, 'dist-electron/main.js'), '--disable-gpu'],
    cwd: root,
    env: environment,
    timeout: 30_000,
  })
  const page = await application.firstWindow()
  await page.waitForFunction(() => Boolean(window.electronAPI?.exportCodingSessionSnapshot))
  await page.route('**/*', (route) => route.abort())
  await assert.rejects(
    page.evaluate((directory) => window.electronAPI.exportCodingSessionSnapshot({ session: {}, destinationDirectory: directory }), destination),
  )
  assert.deepEqual(fs.readdirSync(destination), [])
  const session = {
    id: 'memory-export-probe',
    workspacePath: workspace,
    title: 'Memory export probe',
    createdAt: '2026-10-15T00:00:00.000Z',
    updatedAt: '2026-10-15T00:00:00.000Z',
    actionLogs: [{ id: 'base', timestamp: '2026-10-15T00:00:00.000Z', type: 'info', message: 'Canonical baseline' }],
    executedPrompts: [],
    plans: [],
    promptQueue: [{ id: 'queued', prompt: 'Retain pending work', createdAt: '2026-10-15T00:00:00.000Z' }],
  }
  assert.equal((await page.evaluate((value) => window.electronAPI.saveCodingSession(value), session)).id, session.id)
  const canonicalBytes = fs.readFileSync(historyFile)
  await page.evaluate((value) => {
    window.__memoryExportWorkspace = value
  }, workspace)
  await page.evaluate(javascript)
  await page.waitForFunction(() => document.querySelector('#memory-session')?.textContent?.includes('memory-export-probe'))

  fs.writeFileSync(historyFile, '{unreadable canonical history')
  fs.mkdirSync(path.dirname(recoveryRoot), { recursive: true })
  fs.writeFileSync(recoveryRoot, 'blocked recovery directory')
  await page.getByRole('button', { name: 'Change memory revision', exact: true }).click()
  const exportButton = page.getByRole('button', { name: 'Export changes held in memory', exact: true })
  await exportButton.waitFor()
  const expected = JSON.parse(await page.locator('#memory-session').textContent())
  await assert.rejects(page.evaluate((value) => window.electronAPI.saveCodingSession(value), expected))
  await assert.rejects(page.evaluate((value) => window.electronAPI.stageCodingSession(value), expected))
  assert.equal(await page.evaluate(() => window.__onlyragFlushCodingHistory()), false)

  await application.evaluate(({ dialog }) => {
    globalThis.__memoryExportCloseWarnings = 0
    dialog.showMessageBox = async () => {
      globalThis.__memoryExportCloseWarnings++
      return { response: 0, checkboxChecked: false }
    }
  })
  const window = await application.browserWindow(page)
  await window.evaluate((owned) => owned.close())
  await assert.doesNotReject(async () => {
    const deadline = Date.now() + 15_000
    while (!(await application.evaluate(() => globalThis.__memoryExportCloseWarnings))) {
      assert(Date.now() < deadline, 'Close guard did not report the refused close')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  })
  assert.equal(await window.evaluate((owned) => owned.isDestroyed()), false)

  await application.evaluate(
    ({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
    },
    path.join(scratch, 'missing'),
  )
  await exportButton.click()
  await page.getByText(/Recovery action failed:/).waitFor()
  assert.equal(fs.readdirSync(destination).length, 0)
  assert.equal(await page.evaluate(() => window.__onlyragFlushCodingHistory()), false)
  await application.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
  }, destination)
  await exportButton.click()
  await page.getByText(/Recovery copy saved to/).waitFor()
  const files = fs.readdirSync(destination)
  assert.equal(files.length, 1)
  const exported = JSON.parse(fs.readFileSync(path.join(destination, files[0]), 'utf8'))
  assert.deepEqual(exported.session, expected)
  assert.equal(exported.sessionSha256, createHash('sha256').update(JSON.stringify(exported.session)).digest('hex'))
  assert.equal(fs.readFileSync(historyFile, 'utf8'), '{unreadable canonical history')
  assert.equal(fs.readFileSync(recoveryRoot, 'utf8'), 'blocked recovery directory')
  assert.equal(await page.evaluate(() => window.__onlyragFlushCodingHistory()), false)
  console.log(
    'PASS: real canonical/staging failures block native close; refused export preserves memory; UI export independently matches the full Unicode revision and digest',
  )

  fs.writeFileSync(historyFile, canonicalBytes)
  fs.unlinkSync(recoveryRoot)
  await page.getByRole('button', { name: 'Retry storage', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('#memory-export-fixture [role="alert"]'))
  assert.equal(await page.evaluate(() => window.__onlyragFlushCodingHistory()), true)
  assert.deepEqual(
    JSON.parse(fs.readFileSync(historyFile, 'utf8')).sessions.find((item) => item.id === session.id),
    expected,
  )
  await application.close()
  application = undefined
  complete = true
  console.log('PASS: export leaves canonical acknowledgement pending; retry retains the same revision and releases close after storage is restored')
} finally {
  if (application) await application.evaluate(({ app }) => app.exit()).catch(() => undefined)
  if (complete) {
    assert.equal(path.dirname(path.resolve(scratch)), path.resolve(os.tmpdir()))
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
  } else console.error(`Retained failed probe profile: ${scratch}`)
}
