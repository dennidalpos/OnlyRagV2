import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { createFixtureDirectory, retainFixture } from '../test/fixtureRuntime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const evidence = createFixtureDirectory('onlyrag-artifact-draft-')
const profile = path.join(evidence, 'profile')
const workspace = path.join(evidence, 'synthetic-workspace')
const auditPath = path.join(evidence, 'network-audit.jsonl')
const report = { checks: [], passed: false }
const draftContent = '<h1>Bozza distinta</h1><svg width="40" height="40"><rect width="40" height="40" fill="#d51a68"/></svg>'
let application
let page
try {
  fs.mkdirSync(profile)
  fs.mkdirSync(workspace)
  fs.writeFileSync(
    path.join(profile, 'settings.json'),
    JSON.stringify({
      version: 2,
      settings: {
        language: 'it',
        hasCompletedInitialSetup: true,
        ollamaHost: 'http://127.0.0.1:1',
        autoInstallHubSkills: 'disabled',
      },
    }),
  )
  const env = { ...process.env, ONLYRAG_E2E_TEST: '1', ONLYRAG_E2E_USER_DATA: profile, ONLYRAG_E2E_NETWORK_AUDIT_PATH: auditPath }
  delete env.ELECTRON_RUN_AS_NODE
  application = await electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [path.join(root, 'scripts/e2e/coldStartNetworkBootstrap.cjs')],
    cwd: root,
    env,
    timeout: 30000,
  })
  await application.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] })
  }, workspace)
  page = await application.firstWindow()
  report.console = []
  page.on('console', (message) => {
    if (message.type() === 'error') report.console.push(message.text())
  })
  page.setDefaultTimeout(12000)
  const original = await page.evaluate(
    (workspacePath) =>
      window.electronAPI.saveArtifact({
        workspacePath,
        input: { name: 'Documento originale', kind: 'html', content: '<h1>Contenuto originale</h1>' },
      }),
    workspace,
  )
  const dir = path.join(workspace, '.onlyrag', 'artifacts')
  const originalFile = path.join(dir, `${original.id}.json`)
  const originalBytes = fs.readFileSync(originalFile)
  await page.locator('#tab-coding').click()
  await page.getByRole('button', { name: /^Apri Workspace Explorer/ }).click()
  await page.getByRole('button', { name: 'Aggiungi Cartella Progetto', exact: true }).click()
  await page.getByRole('button', { name: /^Cartella workspace:.*synthetic-workspace/i }).waitFor()
  await page.getByRole('button', { name: 'Nascondi Workspace Explorer', exact: true }).click()
  await page.locator('#coding-tab-artifacts').click()
  await page.getByRole('textbox', { name: 'Contenuto artefatto' }).waitFor()
  const preview = page.locator('iframe[title^="Anteprima "]')
  const waitForHeading = async (name) => {
    const handle = await preview.elementHandle()
    assert.equal(await handle.getAttribute('sandbox'), '')
    const frame = await handle.contentFrame()
    assert.ok(frame)
    await frame.waitForFunction((expected) => document.querySelector('h1')?.textContent === expected, name)
    return frame
  }
  await waitForHeading('Contenuto originale')
  await page.getByRole('button', { name: 'Nuovo', exact: true }).click()
  await page.getByRole('textbox', { name: 'Nome artefatto' }).fill('Secondo artefatto')
  await page.getByRole('textbox', { name: 'Contenuto artefatto' }).fill(draftContent)
  await page.locator('aside').getByRole('button', { name: 'Aggiorna', exact: true }).click()
  const frame = await waitForHeading('Bozza distinta')
  report.raster = []
  for (const [width, height] of [
    [1024, 700],
    [1400, 900],
  ]) {
    await application.evaluate(
      ({ BrowserWindow }, { width, height }) => {
        BrowserWindow.getAllWindows()[0].setContentSize(width, height)
      },
      { width, height },
    )
    await page.waitForFunction(({ width, height }) => innerWidth === width && innerHeight === height, { width, height })
    await frame.waitForFunction(() => document.querySelector('h1 + svg')?.getBoundingClientRect().width === 40, undefined, { polling: 50 })
    const frameBounds = await preview.boundingBox()
    const localMarker = await frame.evaluate(() => {
      const marker = document.querySelector('h1 + svg')
      const { x, y, width, height } = marker.getBoundingClientRect()
      return {
        x,
        y,
        width,
        height,
        viewport: [innerWidth, innerHeight],
        body: document.body.getBoundingClientRect().toJSON(),
        visibility: document.visibilityState,
        styles: [getComputedStyle(document.body).display, getComputedStyle(marker).display],
      }
    })
    assert.ok(frameBounds)
    assert.ok(localMarker.width > 0 && localMarker.height > 0, JSON.stringify({ frameBounds, localMarker }))
    const marker = { ...localMarker, x: frameBounds.x + localMarker.x, y: frameBounds.y + localMarker.y }
    const png = await page.screenshot({ path: path.join(evidence, `draft-${width}.png`), scale: 'css' })
    const { nativePng, playwrightPixel, nativePixel } = await application.evaluate(
      async ({ nativeImage, BrowserWindow }, { png, marker, width, height }) => {
        const capture = await BrowserWindow.getAllWindows()[0].capturePage()
        const sample = (buffer) => {
          const image = nativeImage.createFromBuffer(buffer)
          const size = image.getSize()
          const x = Math.floor(((marker.x + marker.width / 2) * size.width) / width)
          const y = Math.floor(((marker.y + marker.height / 2) * size.height) / height)
          const offset = (y * size.width + x) * 4
          const color = [...image.toBitmap().subarray(offset, offset + 4)]
          return { ...size, x, y, color }
        }
        const nativePng = capture.toPNG()
        return {
          nativePng: nativePng.toString('base64'),
          playwrightPixel: sample(Buffer.from(png, 'base64')),
          nativePixel: sample(nativePng),
        }
      },
      { png: png.toString('base64'), marker, width, height },
    )
    fs.writeFileSync(path.join(evidence, `native-${width}.png`), Buffer.from(nativePng, 'base64'))
    report.raster.push({ width, height, playwrightPixel, nativePixel, frameBounds, marker })
    fs.writeFileSync(path.join(evidence, `frame-${width}.html`), await frame.content())
    for (const { color } of [playwrightPixel, nativePixel]) {
      const [blue, green, red, alpha] = color
      assert.ok(red > 175 && green < 65 && blue > 65 && blue < 140 && alpha === 255, `Artifact marker should be visible in the composited ${width}px capture`)
    }
  }
  report.checks.push('Sandboxed iframe marker is visible in composited screenshots at 1024 and 1400 CSS pixels')
  const save = page.getByRole('button', { name: 'Salva', exact: true })
  await save.click()
  await page
    .locator('aside')
    .getByRole('button', { name: /Secondo artefatto/ })
    .waitFor()
  const records = await page.evaluate((workspacePath) => window.electronAPI.listArtifacts({ workspacePath }), workspace)
  assert.equal(records.length, 2)
  const created = records.find((record) => record.name === 'Secondo artefatto')
  assert.ok(created && created.id !== original.id)
  assert.equal(created.content, draftContent)
  assert.deepEqual(fs.readFileSync(originalFile), originalBytes)
  report.checks.push('New draft survives a refresh, persists under a distinct ID and preserves the original file bytes')
  await page
    .locator('aside')
    .getByRole('button', { name: /Documento originale/ })
    .click()
  await page.getByRole('textbox', { name: 'Contenuto artefatto' }).fill('<h1>Anteprima prima del salvataggio</h1>')
  await waitForHeading('Anteprima prima del salvataggio')
  assert.deepEqual(fs.readFileSync(originalFile), originalBytes)
  report.checks.push('Sandboxed iframe renders the edited content without writing it')
  const truncated = originalBytes.subarray(0, 36)
  fs.writeFileSync(originalFile, truncated)
  await page.locator('aside').getByRole('button', { name: 'Aggiorna', exact: true }).click()
  const alert = page.getByRole('alert').filter({ hasText: 'not valid JSON' })
  await alert.waitFor()
  assert.deepEqual(fs.readFileSync(originalFile), truncated)
  const rejectedSave = alert.getByRole('button', { name: 'Riprova', exact: true })
  await save.click()
  // The IPC write error contains the save channel, distinct from the earlier list error.
  const writeAlert = alert.filter({ hasText: 'artifacts:save' })
  await writeAlert.waitFor()
  assert.deepEqual(fs.readFileSync(originalFile), truncated)
  fs.writeFileSync(originalFile, originalBytes)
  await rejectedSave.click()
  await writeAlert.waitFor({ state: 'hidden' })
  // The earlier read error remains until its own retry succeeds.
  await alert.getByRole('button', { name: 'Riprova', exact: true }).click()
  await alert.waitFor({ state: 'hidden' })
  const updated = JSON.parse(fs.readFileSync(originalFile, 'utf8'))
  assert.equal(updated.id, original.id)
  assert.equal(updated.createdAt, original.createdAt)
  assert.equal(updated.content, '<h1>Anteprima prima del salvataggio</h1>')
  assert.equal((await page.evaluate((workspacePath) => window.electronAPI.listArtifacts({ workspacePath }), workspace)).length, 2)
  report.checks.push('Corrupt record is reported in the panel and survives an attempted save; retry after fixture repair saves the draft under the same ID')
  assert.equal(fs.readFileSync(auditPath, 'utf8'), '')
  report.checks.push('Zero attempted external HTTP(S) requests')
  report.passed = true
} catch (error) {
  report.error = String(error)
  if (page) {
    report.body = await page
      .locator('body')
      .innerText()
      .catch(() => '')
    report.frames = await Promise.all(
      page
        .frames()
        .slice(1)
        .map(async (frame) => ({ url: frame.url(), html: await frame.content().catch(() => '') })),
    )
    await page.screenshot({ path: path.join(evidence, 'failed.png') }).catch(() => {})
  }
  throw error
} finally {
  if (application) await application.close()
  fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  retainFixture(evidence)
  console.log(JSON.stringify({ ...report, evidence }, null, 2))
}
