import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-bundle-ux-'))
const userData = path.join(tempRoot, 'user-data')
const screenshotDir = process.env.ONLYRAG_E2E_SCREENSHOT_DIR || path.join(tempRoot, 'screenshots')
fs.mkdirSync(userData)
fs.mkdirSync(screenshotDir, { recursive: true })
fs.writeFileSync(
  path.join(userData, 'settings.json'),
  JSON.stringify({
    version: 2,
    settings: {
      defaultModel: 'offline-test:latest',
      ocrEngine: 'native_cuda',
      ollamaHost: 'http://127.0.0.1:11434',
      language: 'it',
      hasCompletedInitialSetup: true,
    },
  }),
)

const indexHtml = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8')
assert(!/<link[^>]+(?:modulepreload|stylesheet)[^>]+(?:monaco|tokenizer|editor\.api)/i.test(indexHtml), 'Initial HTML preloads editor or tokenizer assets')

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
  const requests = []
  page.on('request', (request) => requests.push(request.url()))
  await page.reload({ waitUntil: 'load' })
  await page.locator('#panel-ingestion').waitFor()
  await page.waitForTimeout(500)
  assert(
    !requests.some((url) => /\/assets\/(?:editor\.api|monacoTheme|tokenizer-vendor|IngestionMarkdownEditor)/.test(url)),
    'Editor or tokenizer assets loaded before editor UI opened',
  )

  for (const [width, height] of [
    [1024, 700],
    [1400, 900],
  ]) {
    await page.setViewportSize({ width, height })
    for (const tab of ['ingestion', 'chat', 'translation', 'coding', 'settings']) {
      await page.locator(`#tab-${tab}`).click()
      const panel = page.locator(`#panel-${tab}`)
      await panel.waitFor({ state: 'visible' })
      await page.waitForFunction(
        (tabId) => {
          const content = document.getElementById(`panel-${tabId}`)?.textContent?.trim() || ''
          return content.length > 100 && !content.includes('Caricamento interfaccia...')
        },
        tab,
        { timeout: 20_000 },
      )
      assert.equal(await page.locator(`#tab-${tab}`).getAttribute('aria-selected'), 'true')
      const bounds = await panel.boundingBox()
      assert(bounds && bounds.width > 300 && bounds.height > 300, `${tab} panel collapsed at ${width}x${height}`)
      assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `${tab} panel overflows horizontally at ${width}x${height}`)
      if (tab === 'coding') {
        const editorBounds = await panel.locator('[class*="min-w-[350px]"]').first().boundingBox()
        assert(editorBounds && editorBounds.x + editorBounds.width <= width + 1, `coding editor overflows at ${width}x${height}`)
      }
      await page.screenshot({ path: path.join(screenshotDir, `${width}x${height}-${tab}.png`) })
    }

    await page.locator('#panel-settings').getByRole('button', { name: 'Setup Wizard Hardware & Modelli' }).click()
    const wizard = page.getByRole('dialog')
    await wizard.waitFor()
    const wizardBounds = await wizard.boundingBox()
    assert(wizardBounds && wizardBounds.width <= width + 1 && wizardBounds.height <= height + 1)
    await page.screenshot({ path: path.join(screenshotDir, `${width}x${height}-wizard.png`) })
    await page.keyboard.press('Escape')
    await wizard.waitFor({ state: 'hidden' })

    if (width === 1024) {
      assert(!requests.some((url) => url.includes('tokenizer-vendor')), 'Tokenizer loaded before prompt configurator opened')
    }
    await page.locator('#panel-settings').getByRole('button', { name: 'Configurazione Prompt di Sistema' }).click()
    const prompt = page.getByRole('dialog')
    await prompt.waitFor()
    await prompt.locator('.monaco-editor').first().waitFor({ timeout: 20_000 })
    await page.screenshot({ path: path.join(screenshotDir, `${width}x${height}-prompt-editor.png`) })
    assert(
      requests.some((url) => url.includes('tokenizer-vendor')),
      'Tokenizer did not load when prompt configurator opened',
    )
    await page.keyboard.press('Escape')
    await prompt.waitFor({ state: 'hidden' })
  }
  console.log('[PASS] Initial bundle split and two-viewport tabs, wizard, prompt editor checks.')
} finally {
  if (application) await application.close()
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
}
