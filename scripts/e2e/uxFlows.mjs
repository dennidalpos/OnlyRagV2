import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

// Built Renderer, Main and Preload; deterministic IPC services, never a real model or personal profile.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const evidence = process.env.ONLYRAG_UX_EVIDENCE || fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-ux-'))
const userData = path.join(evidence, 'profile')
fs.mkdirSync(userData, { recursive: true })
const settingsFile = path.join(userData, 'settings.json')
if (!fs.existsSync(settingsFile))
  fs.writeFileSync(
    settingsFile,
    JSON.stringify({
      version: 2,
      settings: {
        language: 'it',
        defaultModel: '',
        ollamaHost: 'http://127.0.0.1:1',
        hasCompletedInitialSetup: true,
        translationOutputFolder: path.join(evidence, 'output'),
        autoInstallHubSkills: 'disabled',
      },
    }),
  )
const env = { ...process.env, ONLYRAG_E2E_TEST: '1', ONLYRAG_E2E_USER_DATA: userData }
delete env.ELECTRON_RUN_AS_NODE
const report = { checks: [], pageErrors: [], complete: false }
let application
let page
const record = (name) => {
  report.checks.push(name)
  console.log(`[PASS] ${name}`)
}
async function screenshot(filename) {
  const bytes = await application.evaluate(async ({ BrowserWindow }) => [...(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG()])
  fs.writeFileSync(path.join(evidence, filename), Buffer.from(bytes))
}
async function launch() {
  application = await electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [path.join(root, 'dist-electron/main.js'), '--disable-gpu'],
    cwd: root,
    env,
    timeout: 30000,
  })
  await application.evaluate(({ ipcMain, BrowserWindow }) => {
    globalThis.ux = { ingestions: 0, mode: 'offline', calls: [], translations: 0, cancels: 0, exports: 0 }
    globalThis.uxDoc = {
      id: 'ux-doc',
      filename: 'Synthetic.pdf',
      filePath: 'Synthetic.pdf',
      fileSize: 128,
      numPages: 1,
      numChunks: 1,
      status: 'indexed',
      ingestedAt: 'ux-r1',
      fileType: 'pdf',
      extractedMarkdown: '# Synthetic document\nA deadline for the controlled UX flow.',
    }
    for (const channel of [
      'diagnostics:run',
      'dialog:open-file',
      'ingest:file',
      'ingest:list',
      'ingest:get',
      'ingest:search',
      'ollama:generate-stream',
      'ollama:cancel-stream',
      'ingest:translate-inplace',
      'task:cancel',
      'ingest:export',
    ])
      ipcMain.removeHandler(channel)
    ipcMain.handle('diagnostics:run', () => ({
      sidecar: { status: 'offline' },
      ollama: { status: 'online', url: 'http://127.0.0.1:1', models: ['embedding-only', 'ux-chat'], modelsCount: 2 },
      gpu: { hasNvidiaGpu: false },
      memory: { totalRAMGB: 32, freeRAMGB: 20, usedRAMGB: 12, ramUsagePercent: 37 },
      system: { platform: 'win32', arch: 'x64', cpusCount: 8, cpuModel: 'Synthetic CPU' },
      requirements: { overall: 'warning', checks: [] },
      timestamp: new Date().toISOString(),
    }))
    ipcMain.handle('dialog:open-file', () => ['C:/synthetic/Synthetic.pdf'])
    ipcMain.handle('ingest:file', (event, request) => {
      globalThis.ux.ingestions++
      event.sender.send('ingest:stream-progress', {
        taskId: request.taskId,
        type: 'progress',
        percent: 55,
        fileName: 'Synthetic.pdf',
        step: 'Controlled ingestion progress',
      })
      return new Promise((resolve) => {
        globalThis.ux.finishIngestion = (result) => {
          if (result.success) globalThis.ux.mode = 'documents'
          resolve(result.success ? { ...result, data: { ...globalThis.uxDoc } } : result)
        }
      })
    })
    ipcMain.handle('ingest:list', () => (globalThis.ux.mode === 'offline' ? null : globalThis.ux.mode === 'empty' ? [] : [{ ...globalThis.uxDoc }]))
    ipcMain.handle('ingest:get', () => ({ ...globalThis.uxDoc }))
    ipcMain.handle('ingest:search', () => [
      { doc_id: 'ux-doc', doc_name: 'Synthetic.pdf', chunk_id: 'ux_chunk_0', text: 'A deadline for the controlled UX flow.', score: 0.9 },
    ])
    ipcMain.handle('ollama:generate-stream', (event, request) => {
      globalThis.ux.calls.push(request)
      event.sender.send('ollama:chunk', { operationId: request.operationId, chunk: 'Controlled complete answer.' })
      return new Promise((resolve) => setTimeout(() => resolve({ success: true }), 100))
    })
    ipcMain.handle('ollama:cancel-stream', () => ({ success: true }))
    ipcMain.handle('ingest:translate-inplace', (event, request) => {
      globalThis.ux.translations++
      event.sender.send('ingest:translate-progress', { taskId: request.taskId, type: 'progress', percent: 40 })
      return new Promise((resolve) => {
        globalThis.ux.finishTranslation = resolve
      })
    })
    ipcMain.handle('task:cancel', () => {
      globalThis.ux.cancels++
      globalThis.ux.finishTranslation?.({ success: false, cancelled: true })
      return { success: true }
    })
    ipcMain.handle('ingest:export', () => {
      globalThis.ux.exports++
      return { success: true, data: { filePath: 'Synthetic-output.md' } }
    })
    BrowserWindow.getAllWindows()[0].setSize(1400, 900)
  })
  page = await application.firstWindow()
  page.setDefaultTimeout(15000)
  page.on('pageerror', (error) => report.pageErrors.push(error.message))
  await page.reload()
  await page.locator('#tab-ingestion').click()
  await page.locator('#panel-ingestion').waitFor()
}
async function tab(name) {
  await page.locator(`#tab-${name}`).click()
  await page.locator(`#panel-${name}`).waitFor({ state: 'visible' })
}
async function mode(value) {
  await application.evaluate((_electron, value) => {
    globalThis.ux.mode = value
  }, value)
  await page.evaluate(() => window.dispatchEvent(new Event('onlyrag:documents-changed')))
}
async function keyboardTabs(group) {
  const first = group.getByRole('tab').first()
  await first.focus()
  await page.keyboard.press('End')
  const last = group.getByRole('tab').last()
  assert.equal(await last.getAttribute('aria-selected'), 'true')
  assert.equal(await last.evaluate((el) => document.activeElement === el), true)
  await page.keyboard.press('Home')
  assert.equal(await first.getAttribute('aria-selected'), 'true')
  await page.keyboard.press('ArrowRight')
  assert.equal(await group.getByRole('tab').nth(1).getAttribute('aria-selected'), 'true')
  const current = group.locator('[role="tab"][aria-selected="true"]')
  const panel = await current.getAttribute('aria-controls')
  assert(panel && (await page.locator(`[id="${panel}"]`).isVisible()))
  assert.equal(await page.locator(`[id="${panel}"]`).getAttribute('aria-labelledby'), await current.getAttribute('id'))
}
try {
  await launch()
  for (const name of ['ingestion', 'chat', 'translation']) {
    await tab(name)
    await page.locator(`#panel-${name}`).getByText('Elenco documenti non disponibile.', { exact: false }).first().waitFor()
    assert(!/Nessun documento\.|Nessun documento vettorizzato\.|Nessun documento disponibile\./.test(await page.locator(`#panel-${name}`).innerText()))
  }
  await tab('chat')
  await page.getByText('Ciao! Sono il tuo assistente RAG locale.', { exact: false }).waitFor()
  await page.getByRole('textbox', { name: /Chiedi ai documenti/ }).fill('A question without a configured model')
  assert.equal(await page.getByRole('button', { name: 'Invia', exact: true }).isDisabled(), true)
  await page.getByRole('textbox', { name: /Chiedi ai documenti/ }).press('Enter')
  assert.equal(await page.getByRole('textbox', { name: /Chiedi ai documenti/ }).inputValue(), 'A question without a configured model')
  assert.equal(await application.evaluate(() => globalThis.ux.calls.length), 0)
  assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).settings.defaultModel, '')
  record('Offline is distinct from empty in all document views; new greeting is Italian; absent model blocks Send')

  await page.getByRole('button', { name: 'Scegli modello', exact: true }).click()
  await page.getByRole('option', { name: /ux-chat/ }).click()
  const input = page.getByRole('textbox', { name: /Chiedi ai documenti/ })
  await input.fill('First line')
  await input.press('Shift+Enter')
  await input.press('a')
  assert.equal(await input.inputValue(), 'First line\na')
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })
  assert.equal(await application.evaluate(() => globalThis.ux.calls.length), 0)
  await input.press('Enter')
  await page.getByText('Controlled complete answer.', { exact: true }).waitFor()
  assert.equal(await application.evaluate(() => globalThis.ux.calls.length), 1)
  record('Explicit model selection, multiline, IME protection and one controlled Enter submission')

  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new Error('Controlled clipboard refusal')
    }
  })
  await page.getByRole('button', { name: 'Copia Messaggio', exact: true }).last().click()
  await page.getByText('Copia non riuscita. Riprova dal pulsante Copia.', { exact: true }).waitFor()
  await page.evaluate(() => {
    navigator.clipboard.writeText = async (text) => {
      window.__copied = text
    }
  })
  await page.getByRole('button', { name: 'Copia Messaggio', exact: true }).last().click()
  assert.equal(await page.evaluate(() => window.__copied), 'Controlled complete answer.')
  record('Clipboard refusal is visible and the same Copy action can be retried successfully')

  await mode('empty')
  await tab('ingestion')
  await page.getByText('Nessun documento. Carica un file per iniziare.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Sfoglia File da Caricare', exact: true }).click()
  await page.getByText('Controlled ingestion progress', { exact: true }).waitFor()
  await application.evaluate(() => globalThis.ux.finishIngestion({ success: false, error: 'Controlled ingestion error' }))
  await page.getByText('Controlled ingestion error', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Sfoglia File da Caricare', exact: true }).click()
  await page.getByText('Controlled ingestion progress', { exact: true }).waitFor()
  await application.evaluate(() => globalThis.ux.finishIngestion({ success: true }))
  assert.equal(await application.evaluate(() => globalThis.ux.ingestions), 2)
  record('Controlled picker/ingestion: progress, error, retry and acknowledged document completion')
  await page
    .getByRole('button', { name: /Synthetic.pdf/ })
    .first()
    .waitFor()
  await mode('offline')
  await page.locator('#panel-ingestion').getByText('Impossibile aggiornare i documenti.', { exact: false }).waitFor()
  assert(
    await page
      .getByRole('button', { name: /Synthetic.pdf/ })
      .first()
      .isVisible(),
  )
  await application.evaluate(() => {
    globalThis.ux.mode = 'documents'
  })
  await page.getByRole('button', { name: 'Riprova', exact: true }).click()
  await page.locator('#panel-ingestion').getByText('Impossibile aggiornare i documenti.', { exact: false }).waitFor({ state: 'hidden' })
  record('Verified empty state, document read, stale data preservation and explicit Retry recovery')

  await tab('chat')
  await page
    .getByRole('button', { name: /Synthetic.pdf/ })
    .first()
    .click()
  await page.getByRole('textbox', { name: /Chiedi ai documenti/ }).fill('Check the supplied document')
  await page.getByRole('button', { name: 'Invia', exact: true }).click()
  const citationCopy = page.getByRole('button', { name: 'Copia Citazione', exact: true }).last()
  await citationCopy.waitFor()
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new Error('Controlled citation clipboard refusal')
    }
  })
  await citationCopy.click()
  await page.getByText('Copia non riuscita. Riprova dal pulsante Copia.', { exact: true }).first().waitFor()
  await page.evaluate(() => {
    navigator.clipboard.writeText = async (text) => {
      window.__copied = text
    }
  })
  await citationCopy.click()
  assert.equal(await page.evaluate(() => window.__copied), 'A deadline for the controlled UX flow.')
  record('Citation copy reports refusal and supports an explicit successful retry')
  await keyboardTabs(page.getByRole('tablist', { name: 'Schede pannello laterale chat' }))
  await tab('translation')
  await keyboardTabs(page.getByRole('tablist', { name: 'Modalità traduzione' }))
  await page.locator('#translation-tool-markdown').click()
  await keyboardTabs(page.getByRole('tablist', { name: 'Vista traduzione' }))
  assert.equal(await page.getByRole('tablist', { name: 'Vista traduzione' }).getByRole('button').count(), 0)
  await tab('coding')
  await keyboardTabs(page.getByRole('tablist', { name: 'Aree di lavoro e file' }))
  await page.getByRole('textbox', { name: /Descrivi l.operazione/ }).fill('Controlled draft, never execute')
  assert.equal(await page.getByRole('button', { name: 'Avvia Task', exact: true }).isDisabled(), true)
  record('Internal tabs support Home, End and arrows, name their panels, and keep unrelated controls outside tablists')

  await tab('translation')
  await page.getByRole('button', { name: 'Scegli modello', exact: true }).click()
  await page.getByRole('option', { name: /ux-chat/ }).click()
  await page.locator('#translation-tool-markdown').click()
  await page.getByRole('button', { name: 'Avvia Traduzione', exact: true }).click()
  await page.getByRole('button', { name: 'Copia Traduzione', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Esporta PDF', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('#panel-translation')?.textContent?.includes('PDF'))
  assert.equal(await application.evaluate(() => globalThis.ux.exports), 1)
  await page.locator('#translation-tool-inplace').click()
  await page.getByRole('button', { name: 'Avvia Traduzione con Layout Preservato', exact: true }).click()
  await page.getByText('40%', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Annulla', exact: true }).click()
  await page.getByText('Traduzione annullata. Nessun file di output è stato scritto.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Avvia Traduzione con Layout Preservato', exact: true }).click()
  await application.evaluate(() => globalThis.ux.finishTranslation({ success: false, error: 'Controlled translation error' }))
  await page.getByText('Controlled translation error', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Avvia Traduzione con Layout Preservato', exact: true }).click()
  await application.evaluate(() => globalThis.ux.finishTranslation({ success: true, data: { filename: 'Synthetic-translated.pdf' } }))
  await page.getByText('Documento tradotto con successo: Synthetic-translated.pdf', { exact: true }).waitFor()
  record('Controlled translation: streaming completion/export acknowledgement, in-place progress, cancellation, error and retry completion')
  await page.locator('#translation-tool-markdown').click()
  for (const [width, height] of [
    [1920, 1080],
    [1400, 900],
    [1024, 700],
  ]) {
    await application.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setSize(...bounds), [width, height])
    for (const zoom of [1, 1.5, 2]) {
      await application.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(value), zoom)
      for (const name of ['ingestion', 'chat', 'translation', 'coding', 'settings']) {
        await tab(name)
        await screenshot(`${width}-${height}-${zoom}-${name}.png`)
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
        assert.equal(overflow, false, `Window overflow: ${width}x${height}/${zoom}/${name}`)
        const primary =
          name === 'ingestion'
            ? page.getByRole('button', { name: 'Sfoglia File da Caricare', exact: true })
            : name === 'chat'
              ? page.getByRole('textbox', { name: /Chiedi ai documenti/ })
              : name === 'translation'
                ? page.locator('#translation-tool-markdown')
                : name === 'coding'
                  ? page.locator('#model-selector-coding')
                  : page.locator('#panel-settings h1')
        await primary.scrollIntoViewIfNeeded()
        const visible = await primary.evaluate((el) => {
          const b = el.getBoundingClientRect()
          return b.x >= -1 && b.y >= -1 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1
        })
        if (!visible)
          report.clipping = await primary.evaluate((el) => {
            const rect = (node) => {
              const b = node.getBoundingClientRect()
              return { x: b.x, y: b.y, width: b.width, height: b.height }
            }
            return {
              viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
              target: rect(el),
              parents: [el.parentElement, el.parentElement?.parentElement, document.querySelector('#panel-chat'), document.querySelector('main')]
                .filter(Boolean)
                .map((node) => ({ tag: node.tagName, class: node.className, scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, rect: rect(node) })),
            }
          })
        assert.equal(visible, true, `Clipped primary control: ${width}x${height}/${zoom}/${name}`)
        const navigation = page.locator('#tab-settings')
        await navigation.focus()
        assert.equal(await navigation.evaluate((el) => document.activeElement === el), true)
      }
    }
  }
  record('Five views at three desktop sizes and 100/150/200% zoom: screenshots, no window overflow, keyboard navigation')
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1))
  await tab('chat')
  assert.equal(
    await page
      .locator('#model-selector-chat')
      .innerText()
      .then((x) => x.includes('ux-chat')),
    true,
  )
  await page.evaluate(() => window.__onlyragFlushSettings())
  await application.close()
  application = null
  await launch()
  await tab('chat')
  await page.locator('#model-selector-chat').getByText('ux-chat', { exact: true }).waitFor()
  assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).settings.defaultModel, '')
  record('Selected role survives restart and diagnostics never assigns a default model')
  for (const [width, height] of [
    [1920, 1080],
    [1400, 900],
    [1024, 700],
  ]) {
    await application.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setSize(...bounds), [width, height])
    for (const zoom of [1, 1.5, 2]) {
      await application.evaluate(({ BrowserWindow }, zoom) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom), zoom)
      const opener = page.locator('aside').getByRole('button', { name: 'Setup Wizard Hardware & Modelli', exact: true })
      await opener.click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      for (const key of ['Tab', 'Shift+Tab', 'Tab']) {
        await page.keyboard.press(key)
        assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), true)
      }
      await screenshot(`${width}-${height}-${zoom}-wizard.png`)
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      assert.equal(await opener.evaluate((el) => document.activeElement === el), true)
      assert.equal(await page.evaluate(() => window.__onlyragFlushSettings()), true)
      assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).settings.defaultModel, '')
    }
  }
  record('Wizard at all sizes/zoom: keyboard containment, Escape dismissal, focus restoration and no implicit model assignment')

  assert.deepEqual(report.pageErrors, [])
  report.complete = true
} catch (error) {
  report.error = String(error.stack || error)
  if (page && !page.isClosed())
    report.uiText = await page
      .locator('main')
      .innerText()
      .catch(() => '')
  if (application) report.controlledCalls = await application.evaluate(() => globalThis.ux?.calls).catch(() => [])
  if (page && !page.isClosed()) await screenshot('failure.png').catch(() => {})
  throw error
} finally {
  if (application) await application.close()
  fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  console.log(`Evidence: ${evidence}`)
}
