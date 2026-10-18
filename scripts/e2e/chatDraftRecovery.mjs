import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
async function verifyRecovery(width, height) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-chat-drafts-'))
  const userData = path.join(scratch, 'user-data')
  const archive = path.join(userData, 'document-drafts.json')
  fs.mkdirSync(userData)
  fs.writeFileSync(
    path.join(userData, 'settings.json'),
    JSON.stringify({ version: 2, settings: { language: 'en', hasCompletedInitialSetup: true, defaultModel: 'offline-fixture' } }),
  )
  const environment = { ...process.env, ONLYRAG_E2E_TEST: '1', ONLYRAG_E2E_USER_DATA: userData, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
  delete environment.ELECTRON_RUN_AS_NODE
  let application
  let complete = false
  let page
  async function launch(revision = 't1') {
    application = await electron.launch({
      executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
      args: [path.join(root, 'dist-electron/main.js'), '--disable-gpu'],
      cwd: root,
      env: environment,
      timeout: 30_000,
    })
    await application.evaluate(({ ipcMain, dialog }, revision) => {
      globalThis.__document = {
        id: 'doc',
        filename: 'notes.md',
        filePath: 'notes.md',
        fileSize: 10,
        numPages: 1,
        numChunks: 1,
        status: 'indexed',
        ingestedAt: revision,
        fileType: 'text',
        extractedMarkdown: '# Original',
      }
      globalThis.__saveRequests = []
      globalThis.__closeWarnings = []
      dialog.showMessageBox = async (_window, options) => {
        globalThis.__closeWarnings.push(options.message)
        return { response: 0, checkboxChecked: false }
      }
      for (const channel of ['ingest:list', 'ingest:get', 'ingest:update', 'ollama:generate-stream']) ipcMain.removeHandler(channel)
      ipcMain.handle('ingest:list', () => [{ ...globalThis.__document }])
      ipcMain.handle('ingest:get', () => ({ ...globalThis.__document }))
      ipcMain.handle('ingest:update', (_event, request) => {
        globalThis.__saveRequests.push(request)
        return { success: false, error: 'Document changed; draft retained.' }
      })
      ipcMain.handle('ollama:generate-stream', (event, request) => {
        event.sender.send('ollama:chunk', { operationId: request.operationId, chunk: 'A partial offline answer' })
        return new Promise(() => {})
      })
    }, revision)
    await application.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setSize(bounds.width, bounds.height), { width, height })
    const page = await application.firstWindow()
    await page.reload()
    await page.waitForFunction(() => Boolean(window.electronAPI && window.__onlyragFlushSettings))
    return page
  }
  async function edit(page, text) {
    // Focus Monaco's keyboard input; its visual view-lines center can lie on the overview ruler.
    const editor = page.locator('.monaco-editor [role="textbox"]').first()
    await editor.waitFor()
    await editor.focus()
    assert.equal(await editor.evaluate((element) => element === document.activeElement), true, 'Monaco input must own keyboard focus')
    await page.keyboard.press('Control+A')
    await page.keyboard.insertText(text)
    await page.waitForFunction((value) => document.querySelector('.monaco-editor .view-lines')?.textContent?.replaceAll('\u00a0', ' ').includes(value), text)
  }
  try {
    page = await launch()
    console.log(
      `Desktop recovery probe: window ${width}x${height}, viewport ${JSON.stringify(await page.evaluate(() => ({ width: innerWidth, height: innerHeight })))}`,
    )
    await page.waitForFunction(() => document.querySelector('.monaco-editor .view-lines')?.textContent?.includes('Original'))
    await edit(page, '# Recovered draft')
    assert.equal(await page.evaluate(() => window.__onlyragFlushDocumentDrafts()), true)
    const initialDraft = JSON.parse(fs.readFileSync(archive, 'utf8')).drafts[0]
    assert.equal(initialDraft.ingestedAt, 't1')
    assert.equal(initialDraft.content, '# Recovered draft')
    await page.getByRole('tab', { name: 'RAG & Chat', exact: true }).click()
    await page.getByRole('textbox', { name: /^Ask your documents/ }).fill('An offline question')
    await page.getByRole('textbox', { name: /^Ask your documents/ }).press('Enter')
    // This Playwright runtime treats Promise predicates as truthy in waitForFunction.
    // Poll the real checkpoint file on the host instead of an async browser predicate.
    const checkpointDeadline = Date.now() + 10_000
    let partialSaved = false
    while (Date.now() < checkpointDeadline) {
      const checkpointPath = path.join(userData, 'chat-history-recovery.json')
      if (fs.existsSync(checkpointPath)) {
        const state = JSON.parse(fs.readFileSync(checkpointPath, 'utf8')).state
        partialSaved = state.conversations.some((conversation) =>
          conversation.messages.some((message) => message.text === 'A partial offline answer' && message.isStreaming),
        )
      }
      if (partialSaved) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert(partialSaved, 'The automatic Main checkpoint must contain the partial answer before interruption')
    const recoveredBeforeKill = JSON.parse(fs.readFileSync(path.join(userData, 'chat-history-recovery.json'), 'utf8'))
    assert.equal(recoveredBeforeKill.state.conversations.at(-1).messages.at(-1).text, 'A partial offline answer')
    // Only the process tree returned by this isolated launch is terminated.
    // The application exits after renderer crashes, so recovery requires a fresh launch.
    const interrupted = application.waitForEvent('close', { timeout: 20_000 })
    execFileSync('taskkill', ['/PID', String(application.process().pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    await interrupted
    application = undefined
    page = await launch('t2')
    await page.getByRole('tab', { name: 'RAG & Chat', exact: true }).click()
    await page.getByText('Generation was interrupted before completion. This response is incomplete.', { exact: true }).waitFor()
    await page.getByText('A partial offline answer', { exact: true }).waitFor()
    await page.getByRole('tab', { name: 'Doc Ingestion', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.monaco-editor .view-lines')?.textContent?.includes('Recovered'))
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Document changed' }).waitFor()
    assert.equal(await application.evaluate(() => globalThis.__saveRequests[0].expectedRevision), 't1')

    // A real filesystem refusal must keep Main's window open and leave the draft in memory.
    fs.renameSync(archive, archive + '.held')
    fs.mkdirSync(archive)
    // Keep the whole fixture visible when word-wrapped at the native minimum width.
    await edit(page, '# Newer draft')
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    const failure = page.getByRole('alert').filter({ hasText: 'Document draft recovery could not be saved or loaded' })
    await failure.waitFor()
    await page.waitForFunction(() => Boolean(window.__onlyragFlushDocumentDrafts))
    assert(fs.statSync(archive).isDirectory())
    assert.equal(
      await application.evaluate(async () => {
        const deadline = Date.now() + 3000
        while (!globalThis.__closeWarnings.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
        return globalThis.__closeWarnings.length
      }),
      1,
    )
    fs.rmdirSync(archive)
    fs.renameSync(archive + '.held', archive)
    await failure.getByRole('button', { name: 'Retry', exact: true }).click()
    await failure.waitFor({ state: 'detached' })
    const closed = application.waitForEvent('close', { timeout: 20_000 })
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await closed
    application = undefined
    const saved = JSON.parse(fs.readFileSync(archive, 'utf8')).drafts[0]
    assert.equal(saved.content, '# Newer draft')
    assert.equal(saved.ingestedAt, 't1')
    page = await launch()
    await page.waitForFunction(() => document.querySelector('.monaco-editor .view-lines')?.textContent?.includes('Newer'))
    assert.equal(await page.evaluate(() => window.__onlyragFlushDocumentDrafts()), true)
    await application.close()
    application = undefined
    complete = true
    console.log(
      '[PASS] Real Main/Preload: active chat survives forced process interruption as incomplete; drafts retain their original revision, failed writes refuse close, retry and restart readback succeed. No real-model calls.',
    )
  } catch (error) {
    if (page && !page.isClosed()) {
      try {
        await page.screenshot({ path: path.join(scratch, 'failure.png') })
        const diagnostics = await page.evaluate(() => {
          const describe = (element) =>
            element && { tag: element.tagName, class: element.className, role: element.getAttribute('role'), bounds: element.getBoundingClientRect().toJSON() }
          const lines = document.querySelector('.monaco-editor .view-lines')
          const bounds = lines?.getBoundingClientRect()
          const center = bounds && {
            x: (Math.max(0, bounds.left) + Math.min(innerWidth, bounds.right)) / 2,
            y: (Math.max(0, bounds.top) + Math.min(innerHeight, bounds.bottom)) / 2,
          }
          return {
            viewport: { width: innerWidth, height: innerHeight },
            active: describe(document.activeElement),
            input: describe(document.querySelector('.monaco-editor [role="textbox"]')),
            renderedText: lines?.textContent,
            lines: describe(lines),
            center,
            centerHit: center && describe(document.elementFromPoint(center.x, center.y)),
          }
        })
        fs.writeFileSync(path.join(scratch, 'failure.json'), JSON.stringify(diagnostics, null, 2))
        console.error('Chat/draft failure geometry:', JSON.stringify(diagnostics))
      } catch (diagnosticError) {
        console.error('Chat/draft diagnostics unavailable:', diagnosticError)
      }
    }
    console.error('Chat/draft probe failed:', error)
    throw error
  } finally {
    if (application && application.process().exitCode === null) {
      // Failures must not hang in the close-refusal path being tested.
      try {
        execFileSync('taskkill', ['/PID', String(application.process().pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      } catch (cleanupError) {
        console.error(`Could not terminate owned fixture PID ${application.process().pid}:`, cleanupError)
      }
    }
    if (complete) {
      assert.equal(path.dirname(path.resolve(scratch)), path.resolve(os.tmpdir()))
      assert(path.basename(scratch).startsWith('onlyrag-chat-drafts-'))
      fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    } else console.error(`Retained failed chat/draft fixture: ${scratch}`)
  }
}

// The minimum native window reproduces the CI ruler interception; also exercise the 1080p target.
for (const [width, height] of [
  [1024, 720],
  [1920, 1080],
])
  await verifyRecovery(width, height)
