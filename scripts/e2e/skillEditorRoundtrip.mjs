import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { createFixtureDirectory, retainFixture } from '../test/fixtureRuntime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const evidence = createFixtureDirectory('onlyrag-skill-editor-')
const profile = path.join(evidence, 'profile')
const audit = path.join(evidence, 'network.jsonl')
const skillFile = path.join(profile, 'skills', 'editor-fixture', 'SKILL.md')
const input = {
  name: 'editor-fixture',
  description: '  Synthetic editor fixture  ',
  author: 'Synthetic ',
  version: ' 1.2.3 ',
  content: ' \n# Original body\n\n  trailing  \n\n',
  triggers: ['Mixed Case', 'comma,value', 'line\r\nbreak', 'C:\\temp'],
  tags: ['"quoted"', 'tag\nline'],
}
const env = { ...process.env, ONLYRAG_E2E_TEST: '1', ONLYRAG_E2E_USER_DATA: profile, ONLYRAG_E2E_NETWORK_AUDIT_PATH: audit }
delete env.ELECTRON_RUN_AS_NODE
let app
const report = { checks: [], passed: false }

async function launch() {
  app = await electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [path.join(root, 'scripts/e2e/coldStartNetworkBootstrap.cjs')],
    cwd: root,
    env,
    timeout: 30000,
  })
  // Marketplace content is unrelated to this test. All editor and storage IPC handlers remain real.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('skills:list-hub-all')
    ipcMain.handle('skills:list-hub-all', () => [])
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(12000)
  return page
}

const findSkill = (page) => page.evaluate(async () => (await window.electronAPI.listInstalledSkills({})).find((skill) => skill.id === 'editor-fixture'))
async function openEditor(page) {
  await page.locator('#tab-coding').click()
  await page
    .getByRole('button', { name: /Apri Skill Hub|Skill attive/i })
    .first()
    .click()
  await page.getByRole('button', { name: 'Modifica editor-fixture', exact: true }).click()
  const editor = page.getByRole('dialog').filter({ has: page.locator('#skill-editor-modal-title') })
  await editor.waitFor()
  return editor
}

try {
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
  const page = await launch()
  const result = await page.evaluate((payload) => window.electronAPI.saveCustomSkill({ input: payload }), input)
  assert.equal(result.success, true, result.error)
  const baseline = await findSkill(page)
  const bytes = fs.readFileSync(skillFile)
  let editor = await openEditor(page)
  await editor.getByRole('button', { name: 'Salva', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  assert.deepEqual(fs.readFileSync(skillFile), bytes)
  report.checks.push('Untouched editor save preserves the original SKILL.md byte for byte')
  const hub = page.getByRole('dialog').filter({ has: page.locator('#skill-hub-modal-title') })
  await hub.getByRole('button', { name: 'Chiudi', exact: true }).click()
  editor = await openEditor(page)
  const trigger = editor.getByRole('textbox', { name: 'Trigger di Attivazione 3', exact: true })
  await trigger.fill('Cancelled\nEdit')
  await editor.getByRole('button', { name: 'Annulla', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  assert.deepEqual(fs.readFileSync(skillFile), bytes)
  await hub.getByRole('button', { name: 'Chiudi', exact: true }).click()
  editor = await openEditor(page)
  await trigger.fill('Edited, Value\nSecond Line')
  const save = editor.getByRole('button', { name: 'Salva', exact: true })
  await page.setViewportSize({ width: 1024, height: 700 })
  await page.screenshot({ path: path.join(evidence, 'editor.png') })
  // Real Windows read-only replacement failure. Restore it on every path.
  fs.chmodSync(skillFile, 0o444)
  try {
    await save.click()
    await editor.getByRole('alert').waitFor()
    assert.equal(await trigger.inputValue(), 'Edited, Value\nSecond Line')
    assert.deepEqual(fs.readFileSync(skillFile), bytes)
  } finally {
    fs.chmodSync(skillFile, 0o666)
  }
  await save.click()
  await editor.waitFor({ state: 'hidden' })
  const expectedTriggers = ['Mixed Case', 'comma,value', 'Edited, Value\nSecond Line', 'C:\\temp']
  assert.deepEqual((await findSkill(page)).triggers, expectedTriggers)
  assert.equal(fs.readFileSync(audit, 'utf8'), '')
  await app.close()
  app = undefined
  const reopened = await launch()
  const loaded = await findSkill(reopened)
  for (const key of ['name', 'description', 'author', 'version', 'content']) assert.equal(loaded[key], baseline[key])
  assert.deepEqual(loaded.triggers, expectedTriggers)
  assert.deepEqual(loaded.tags, input.tags)
  assert.equal(fs.readFileSync(audit, 'utf8'), '')
  report.checks.push(
    'Cancel leaves bytes unchanged. Native save failure preserves draft. Retry and a fresh Electron process retain the edited multiline entry and untouched data',
  )
  report.passed = true
} finally {
  if (app) await app.close()
  fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  retainFixture(evidence)
  console.log(JSON.stringify({ ...report, evidence }, null, 2))
}
