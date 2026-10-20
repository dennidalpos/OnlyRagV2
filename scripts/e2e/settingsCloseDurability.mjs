import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const qualifiedExe = process.env.ONLYRAG_QUALIFICATION_EXE
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-settings-close-'))
const userData = path.join(scratch, 'user-data')
const settingsPath = path.join(userData, 'settings.json')
fs.mkdirSync(userData)
const initial = JSON.stringify({ version: 2, settings: { language: 'en', hasCompletedInitialSetup: true, defaultModel: 'offline-fixture' } })
fs.writeFileSync(settingsPath, initial)
const environment = { ...process.env, ONLYRAG_E2E_TEST: '1', ONLYRAG_E2E_USER_DATA: userData, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
delete environment.ELECTRON_RUN_AS_NODE
let application
let complete = false
async function launch() {
  application = await electron.launch({
    executablePath: qualifiedExe || path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: qualifiedExe ? ['--disable-gpu'] : [path.join(root, 'dist-electron/main.js'), '--disable-gpu'],
    cwd: root,
    env: environment,
    timeout: 30_000,
  })
  const page = await application.firstWindow()
  await page.waitForFunction(() => Boolean(window.electronAPI && window.__onlyragFlushSettings))
  await page.waitForFunction(() =>
    /Settings saved\.|Impostazioni salvate\./.test(document.querySelector('[data-testid="settings-save-status"]')?.textContent || ''),
  )
  return page
}
try {
  const page = await launch()
  await application.evaluate(({ dialog }) => {
    globalThis.__closeWarnings = []
    dialog.showMessageBox = async (_window, options) => {
      globalThis.__closeWarnings.push(options.message)
      return { response: 0, checkboxChecked: false }
    }
  })
  // Hold only the automatic debounce. The native close must flush without waiting for this timer.
  await page.evaluate(() => {
    const schedule = window.setTimeout.bind(window)
    window.setTimeout = (callback, delay, ...args) => schedule(callback, delay === 100 ? 60_000 : delay, ...args)
  })
  fs.unlinkSync(settingsPath)
  fs.mkdirSync(settingsPath)
  await page.locator('aside button:has(svg.lucide-globe)').click()
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await page.getByTestId('settings-save-retry').waitFor()
  await assert.doesNotReject(page.title())
  assert.equal((await application.evaluate(() => globalThis.__closeWarnings)).length, 1)
  assert(fs.statSync(settingsPath).isDirectory(), 'A refused close must not overwrite the obstructing path')
  fs.rmdirSync(settingsPath)
  fs.writeFileSync(settingsPath, initial)
  const closed = application.waitForEvent('close', { timeout: 20_000 })
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
  assert.equal(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).settings.language, 'it')

  const restarted = await launch()
  assert.equal(await restarted.locator('aside button:has(svg.lucide-globe)').textContent(), 'IT')
  const acknowledged = fs.readFileSync(settingsPath, 'utf8')
  const owned = application.process()
  const exited = new Promise((resolve) => owned.once('exit', resolve))
  execFileSync('taskkill', ['/PID', String(owned.pid), '/T', '/F'], { stdio: 'ignore' })
  await exited
  await application.close().catch(() => {})
  application = undefined
  const afterKill = await launch()
  assert.equal(await afterKill.locator('aside button:has(svg.lucide-globe)').textContent(), 'IT')
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).settings, JSON.parse(acknowledged).settings)
  await application.close()
  application = undefined
  complete = true
  if (process.env.ONLYRAG_QUALIFICATION_EVIDENCE) {
    fs.mkdirSync(process.env.ONLYRAG_QUALIFICATION_EVIDENCE, { recursive: true })
    fs.writeFileSync(
      path.join(process.env.ONLYRAG_QUALIFICATION_EVIDENCE, 'settings-close.json'),
      JSON.stringify(
        {
          executablePath: qualifiedExe || 'development',
          settings: JSON.parse(acknowledged),
          assertions: [
            'pending close flush',
            'failed write preserves obstruction',
            'retry and close',
            'restart language',
            'owned force kill',
            'acknowledged revision after second restart',
          ],
          limits: 'Isolated E2E profile, automatic Sidecar disabled; no model or power-loss qualification.',
        },
        null,
        2,
      ),
    )
  }
  console.log(
    '[PASS] Real Main/Preload close waits for pending settings, refuses a failed write, retries and reloads the saved language after restart. No model calls.',
  )
} finally {
  if (application) await application.close()
  if (complete) {
    assert.equal(path.dirname(path.resolve(scratch)), path.resolve(os.tmpdir()))
    assert(path.basename(scratch).startsWith('onlyrag-settings-close-'))
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  } else console.error(`Retained failed settings-close fixture: ${scratch}`)
}
