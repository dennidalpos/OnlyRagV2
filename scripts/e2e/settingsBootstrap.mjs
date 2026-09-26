import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-settings-bootstrap-'))
const userData = path.join(tempRoot, 'user-data')
const settingsPath = path.join(userData, 'settings.json')
const explicitSettings = { defaultModel: 'offline-test:latest', language: 'en', hasCompletedInitialSetup: true }
fs.mkdirSync(userData)
fs.writeFileSync(settingsPath, JSON.stringify({ version: 2, settings: explicitSettings }))

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
  await page.waitForFunction(() => Boolean(window.electronAPI), undefined, { timeout: 20_000 })
  const settingsBanner = page.getByTestId('settings-bootstrap-error')

  // Real settings:get handler: the versioned settings.json is loaded as written.
  await page.reload({ waitUntil: 'load' })
  await page.locator('#tab-ingestion').getByText('Doc Ingestion').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(350)
  let persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
  assert.equal(persisted.settings.defaultModel, explicitSettings.defaultModel)
  assert.equal(persisted.settings.language, 'en')
  assert.equal(await page.getByRole('dialog').count(), 0, 'Wizard opened despite completed setup in settings.json')

  // Real settings:get handler with an unreadable or unversioned file: recoverable error, no overwrite, no diagnostics, then retry.
  const validSettingsFile = fs.readFileSync(settingsPath)
  const unversionedSettingsFile = JSON.stringify(explicitSettings)
  fs.writeFileSync(settingsPath, unversionedSettingsFile)
  await page.reload({ waitUntil: 'load' })
  await settingsBanner.waitFor({ timeout: 10_000 })
  assert.equal(fs.readFileSync(settingsPath, 'utf8'), unversionedSettingsFile, 'Unversioned settings.json was rewritten')
  const corruptSettingsFile = '{ "version": 2, "settings": '
  fs.writeFileSync(settingsPath, corruptSettingsFile)
  await application.evaluate(({ ipcMain }) => {
    globalThis.__diagnosticsCalls = 0
    ipcMain.removeHandler('diagnostics:run')
    ipcMain.handle('diagnostics:run', async () => {
      globalThis.__diagnosticsCalls++
      return {
        sidecar: { status: 'offline', documentsCount: 0 },
        ollama: { status: 'online', url: 'http://127.0.0.1:11434', modelsCount: 1, models: ['bge-m3:latest'] },
        gpu: { hasNvidiaGpu: false },
        memory: { totalRAMGB: 8, freeRAMGB: 4, usedRAMGB: 4, ramUsagePercent: 50 },
      }
    })
  })
  await page.reload({ waitUntil: 'load' })
  await settingsBanner.waitFor({ timeout: 10_000 })
  await page.waitForTimeout(1_200)
  assert.equal(fs.readFileSync(settingsPath, 'utf8'), corruptSettingsFile, 'Unreadable settings.json was overwritten')
  assert.equal(await application.evaluate(() => globalThis.__diagnosticsCalls), 0, 'Diagnostics ran without loaded settings')
  assert.equal(await page.getByRole('dialog').count(), 0, 'Wizard opened after a failed settings read')
  fs.writeFileSync(settingsPath, validSettingsFile)
  await settingsBanner.getByRole('button').click()
  await settingsBanner.waitFor({ state: 'detached', timeout: 10_000 })
  await page.waitForTimeout(400)
  assert((await application.evaluate(() => globalThis.__diagnosticsCalls)) > 0, 'Diagnostics did not start after a successful retry')
  persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
  assert.equal(persisted.settings.defaultModel, explicitSettings.defaultModel)

  await application.evaluate(({ ipcMain }) => {
    globalThis.__settingsBootstrapTiming = { settingsGetStarted: 0, settingsLoaded: 0, firstDiagnosticsCall: 0 }
    ipcMain.removeHandler('settings:get')
    ipcMain.handle('settings:get', async () => {
      globalThis.__settingsBootstrapTiming.settingsGetStarted = Date.now()
      await new Promise((resolve) => setTimeout(resolve, 600))
      globalThis.__settingsBootstrapTiming.settingsLoaded = Date.now()
      return { defaultModel: 'offline-test:latest', language: 'en', hasCompletedInitialSetup: true }
    })
    ipcMain.removeHandler('diagnostics:run')
    ipcMain.handle('diagnostics:run', async () => {
      if (globalThis.__settingsBootstrapTiming.settingsGetStarted) {
        globalThis.__settingsBootstrapTiming.firstDiagnosticsCall ||= Date.now()
      }
      await new Promise((resolve) => setTimeout(resolve, 900))
      return {
        sidecar: { status: 'offline', documentsCount: 0 },
        ollama: { status: 'online', url: 'http://127.0.0.1:11434', modelsCount: 1, models: ['bge-m3:latest'] },
        gpu: { hasNvidiaGpu: false },
        memory: { totalRAMGB: 8, freeRAMGB: 4, usedRAMGB: 4, ramUsagePercent: 50 },
      }
    })
  })
  await page.reload({ waitUntil: 'load' })
  await page.locator('#tab-ingestion').getByText('Doc Ingestion').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(1_800)

  const timing = await application.evaluate(() => globalThis.__settingsBootstrapTiming)
  assert(timing.settingsGetStarted && timing.firstDiagnosticsCall, 'Bootstrap or diagnostics did not run')
  assert(timing.firstDiagnosticsCall >= timing.settingsLoaded, 'Diagnostics started before settings bootstrap completed')
  persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
  assert.equal(persisted.settings.defaultModel, explicitSettings.defaultModel)
  assert.equal(persisted.settings.language, explicitSettings.language)
  assert.equal(persisted.settings.hasCompletedInitialSetup, true)
  assert.equal(await page.getByRole('dialog').count(), 0, 'Wizard opened despite completed setup')
  await application.close()

  application = await electron.launch({
    executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [path.join(root, 'dist-electron', 'main.js'), '--disable-gpu'],
    cwd: root,
    env: { ...process.env, ONLYRAG_E2E_TEST: '1', ONLYRAG_E2E_USER_DATA: userData, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
    timeout: 30_000,
  })
  const writesPage = await application.firstWindow()
  await writesPage.waitForFunction(() => Boolean(window.electronAPI), undefined, { timeout: 20_000 })
  await writesPage.locator('#tab-ingestion').getByText('Doc Ingestion').waitFor({ timeout: 10_000 })
  await writesPage.waitForTimeout(350)

  await application.evaluate(({ ipcMain }) => {
    globalThis.__settingsWrites = { calls: 0, active: 0, maxActive: 0, last: null }
    ipcMain.removeHandler('settings:save')
    ipcMain.handle('settings:save', async (_, settings) => {
      const writes = globalThis.__settingsWrites
      writes.calls++
      writes.active++
      writes.maxActive = Math.max(writes.maxActive, writes.active)
      await new Promise((resolve) => setTimeout(resolve, 250))
      writes.last = settings
      writes.active--
      return true
    })
  })
  const languageButton = writesPage.locator('aside button:has(svg.lucide-globe)')
  await languageButton.click()
  await languageButton.click()
  await languageButton.click()
  await writesPage.waitForTimeout(450)
  let writes = await application.evaluate(() => globalThis.__settingsWrites)
  assert.equal(writes.calls, 1, 'Rapid changes were not coalesced into one save')
  assert.equal(writes.last.language, 'it')
  await languageButton.click()
  await writesPage.waitForTimeout(150)
  await languageButton.click()
  await writesPage.waitForTimeout(650)
  writes = await application.evaluate(() => globalThis.__settingsWrites)
  assert.equal(writes.calls, 3, 'Separated changes did not produce the expected saves')
  assert.equal(writes.maxActive, 1, 'Settings saves overlapped')
  assert.equal(writes.last.language, 'it')
  console.log('[PASS] Settings bootstrap, versioned file load, unreadable and unversioned file recovery, language, wizard and serialized/coalesced writes.')
} finally {
  if (application) await application.close()
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
}
