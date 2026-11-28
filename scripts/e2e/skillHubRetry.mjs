import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { createFixtureDirectory, retainFixture } from '../test/fixtureRuntime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const evidence = createFixtureDirectory('onlyrag-skill-hub-retry-')
const profile = path.join(evidence, 'profile')
fs.mkdirSync(profile)
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
const hubsFile = path.join(profile, 'custom_hubs.json')
const original = '[{"id":"synthetic-truncated"'
fs.writeFileSync(hubsFile, original)
const auditPath = path.join(evidence, 'network-audit.jsonl')
const env = {
  ...process.env,
  ONLYRAG_E2E_TEST: '1',
  ONLYRAG_E2E_USER_DATA: profile,
  ONLYRAG_E2E_NETWORK_AUDIT_PATH: auditPath,
  ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
}
delete env.ELECTRON_RUN_AS_NODE
let application
const report = { passed: false, evidence, checks: [] }
try {
  application = await electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [path.join(root, 'scripts/e2e/coldStartNetworkBootstrap.cjs'), '--disable-gpu'],
    cwd: root,
    env,
    timeout: 30000,
  })
  // Keep source loading on real IPC and the real filesystem. Remote catalogue reads use synthetic offline data.
  await application.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('skills:list-hub-all')
    ipcMain.handle('skills:list-hub-all', () => [
      {
        id: 'synthetic-skill',
        name: 'Recovered synthetic skill',
        description: 'Offline retry fixture',
        category: 'frontend',
        tags: [],
        triggers: [],
        version: '1.0',
        author: 'Fixture',
      },
    ])
    ipcMain.removeHandler('skills:list-hub-by-source')
    ipcMain.handle('skills:list-hub-by-source', () => [])
  })
  const page = await application.firstWindow()
  page.setDefaultTimeout(12000)
  await page.locator('#tab-coding').click()
  await page.getByRole('button', { name: 'Apri Skill Hub & Marketplace', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.locator('#skill-hub-modal-title') })
  const error = dialog.getByRole('alert')
  await error.waitFor()
  assert.match(await error.innerText(), /not valid JSON/)
  assert.equal(await dialog.getByRole('tabpanel').count(), 0)
  assert.equal(fs.readFileSync(hubsFile, 'utf8'), original)
  report.checks.push('Real source IPC rejects truncated file; original bytes preserved; no empty list presented')
  for (const [width, height] of [
    [1024, 700],
    [1400, 900],
  ]) {
    await page.setViewportSize({ width, height })
    const retry = error.getByRole('button', { name: 'Riprova', exact: true })
    await retry.focus()
    assert.equal(await retry.evaluate((button) => button === document.activeElement), true)
    const bounds = await retry.boundingBox()
    assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height)
    await page.screenshot({ path: path.join(evidence, `error-${width}x${height}.png`) })
  }
  await error.getByRole('button', { name: 'Riprova', exact: true }).click()
  await error.getByRole('button', { name: 'Riprova', exact: true }).waitFor()
  assert.equal(fs.readFileSync(hubsFile, 'utf8'), original)
  report.checks.push('Repeated failed retry leaves bytes unchanged')
  const repaired = JSON.stringify([
    { id: 'synthetic-source', name: 'Recovered source', url: 'http://127.0.0.1:1/hub', type: 'json-catalog', description: 'Synthetic', isBuiltin: false },
  ])
  fs.writeFileSync(hubsFile, repaired)
  await error.getByRole('button', { name: 'Riprova', exact: true }).click()
  await error.waitFor({ state: 'hidden' })
  await dialog.getByRole('tab', { name: 'Marketplace & Hub' }).click()
  await dialog.getByText('Recovered synthetic skill', { exact: true }).waitFor()
  assert.equal(fs.readFileSync(hubsFile, 'utf8'), repaired)
  await page.screenshot({ path: path.join(evidence, 'recovered.png') })
  report.checks.push('Repair followed by retry restores list in same modal, without rewriting repaired file')
  await dialog.getByRole('button', { name: 'Aggiungi Hub Personalizzato', exact: true }).click()
  const form = page.getByRole('dialog').filter({ has: page.locator('#add-custom-hub-title') })
  await form.locator('#hub-name-input').fill('Temporary synthetic hub')
  await form.locator('#hub-url-input').fill('http://127.0.0.1:1/synthetic-hub')
  await form.getByRole('button', { name: 'Aggiungi Hub Personalizzato', exact: true }).click()
  await form.waitFor({ state: 'hidden' })
  const remove = dialog.getByRole('button', { name: 'Elimina Temporary synthetic hub', exact: true })
  await remove.waitFor()
  const [previous, added] = JSON.parse(fs.readFileSync(hubsFile, 'utf8'))
  assert.deepEqual(previous, JSON.parse(repaired)[0])
  assert.equal(added.name, 'Temporary synthetic hub')
  await remove.click()
  await page.getByRole('button', { name: 'Conferma — Temporary synthetic hub', exact: true }).click()
  await dialog.getByText('Sorgente hub rimossa.', { exact: true }).waitFor()
  assert.deepEqual(JSON.parse(fs.readFileSync(hubsFile, 'utf8')), JSON.parse(repaired))
  report.checks.push('UI adds and removes a synthetic source through real IPC while preserving the recovered source')
  assert.equal(fs.readFileSync(auditPath, 'utf8'), '')
  report.checks.push('Zero external network attempts; remote catalogue only is synthetic')
  report.passed = true
  console.log(JSON.stringify(report, null, 2))
} finally {
  if (application) await application.close()
  fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  retainFixture(evidence)
  console.log(`Evidence: ${evidence}`)
}
