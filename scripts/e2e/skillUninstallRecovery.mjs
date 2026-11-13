import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { createFixtureDirectory, retainFixture } from '../test/fixtureRuntime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const evidence = createFixtureDirectory('onlyrag-skill-uninstall-')
const profile = path.join(evidence, 'profile')
const workspace = path.join(evidence, 'synthetic-workspace')
const audit = path.join(evidence, 'network.jsonl')
const boundary = path.join(evidence, 'staged.json')
const env = { ...process.env, ONLYRAG_E2E_TEST: '1', ONLYRAG_E2E_USER_DATA: profile, ONLYRAG_E2E_NETWORK_AUDIT_PATH: audit }
delete env.ELECTRON_RUN_AS_NODE
let app
const report = { checks: [], passed: false }
const name = 'uninstall-fixture'

async function launch() {
  app = await electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [path.join(root, 'scripts/e2e/coldStartNetworkBootstrap.cjs')],
    cwd: root,
    env,
    timeout: 30000,
  })
  await app.evaluate(({ ipcMain, dialog }, selected) => {
    ipcMain.removeHandler('skills:list-hub-all')
    ipcMain.handle('skills:list-hub-all', () => [])
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] })
  }, workspace)
  const page = await app.firstWindow()
  page.setDefaultTimeout(12000)
  return page
}

const installed = (page, workspaceRoot) =>
  page.evaluate(
    async (scope) => (await window.electronAPI.listInstalledSkills({ workspaceRoot: scope })).find((entry) => entry.id === 'uninstall-fixture'),
    workspaceRoot,
  )

async function openHub(page, local, waitForSkill = true) {
  await page.locator('#tab-coding').click()
  if (local) {
    await page.getByRole('button', { name: /^Apri Workspace Explorer/ }).click()
    await page.getByRole('button', { name: 'Aggiungi Cartella Progetto', exact: true }).click()
    await page.getByRole('button', { name: /^Cartella workspace:.*synthetic-workspace/i }).waitFor()
  }
  await page
    .getByRole('button', { name: /Apri Skill Hub|Skill attive/i })
    .first()
    .click()
  const hub = page.getByRole('dialog').filter({ has: page.locator('#skill-hub-modal-title') })
  if (waitForSkill) await hub.getByRole('button', { name: `Elimina ${name}`, exact: true }).waitFor()
  return hub
}

async function confirm(page, hub) {
  await hub.getByRole('button', { name: `Elimina ${name}`, exact: true }).click()
  await page.getByRole('button', { name: `Conferma — ${name}`, exact: true }).click()
}

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
  let page = await launch()
  const provision = (workspaceRoot, content) =>
    page.evaluate(
      ({ workspaceRoot, content }) =>
        window.electronAPI.saveCustomSkill({ workspaceRoot, input: { name: 'uninstall-fixture', content, originHub: 'builtin://synthetic' } }),
      { workspaceRoot, content },
    )
  assert.equal((await provision(undefined, '# Global hub skill')).success, true)
  assert.equal((await provision(workspace, '# Workspace hub override')).success, true)
  const global = await installed(page)
  const local = await installed(page, workspace)
  const globalBytes = fs.readFileSync(global.filePath)
  const localBytes = fs.readFileSync(local.filePath)
  let hub = await openHub(page, true)
  await confirm(page, hub)
  await hub.getByText(`Skill '${name}' eliminata.`, { exact: true }).waitFor()
  assert.equal(fs.existsSync(local.filePath), false)
  assert.deepEqual(fs.readFileSync(global.filePath), globalBytes)
  assert.equal((await installed(page, workspace)).isActive, true)
  report.checks.push('UI uninstall removes the synthetic workspace override and preserves the active global hub skill')

  // Stop inside the real repository operation, immediately before recursive removal.
  await app.evaluate(
    ({ app: electronApp }, { boundary, profile }) => {
      const fs = process.getBuiltinModule('node:fs')
      const path = process.getBuiltinModule('node:path')
      const remove = fs.promises.rm.bind(fs.promises)
      const skills = path.join(profile, 'skills')
      fs.promises.rm = (target, options) => {
        if (path.dirname(target) !== skills || !path.basename(target).startsWith('.uninstall-fixture.removing-')) return remove(target, options)
        fs.writeFileSync(boundary, JSON.stringify({ target }), { flag: 'wx', flush: true })
        electronApp.exit(81)
        return new Promise(() => {})
      }
    },
    { boundary, profile },
  )
  const exited = once(app.process(), 'exit', { signal: AbortSignal.timeout(15000) })
  const dispatched = page.evaluate(() => window.electronAPI.uninstallSkill({ skillId: 'uninstall-fixture' })).catch(() => {})
  const [code] = await exited
  await dispatched
  assert.equal(code, 81)
  app = undefined
  const staged = JSON.parse(fs.readFileSync(boundary, 'utf8')).target
  assert.deepEqual(fs.readFileSync(path.join(staged, 'SKILL.md')), globalBytes)
  assert.equal(fs.existsSync(global.filePath), false)
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'active_skills.json'), 'utf8')).includes(name), false)
  page = await launch()
  const recovered = await installed(page)
  assert.equal(recovered.isActive, true)
  assert.deepEqual(fs.readFileSync(recovered.filePath), globalBytes)
  assert.equal(fs.existsSync(staged), false)
  assert.equal(
    fs.readdirSync(path.join(profile, 'skill-uninstall-receipts'), { recursive: true }).some((entry) => entry.endsWith('.receipt.json')),
    false,
  )
  const retried = await page.evaluate(() => window.electronAPI.uninstallSkill({ skillId: 'uninstall-fixture' }))
  assert.equal(retried.success, true, retried.error)
  assert.equal(await installed(page), undefined)
  assert.notDeepEqual(globalBytes, localBytes)
  assert.equal(fs.readFileSync(audit, 'utf8'), '')
  report.checks.push('Electron exits after staging, restarts to identical bytes and active state, then completes an explicit retry')

  for (const conflict of [false, true]) {
    assert.equal((await provision(undefined, '# Retained original')).success, true)
    const current = await installed(page)
    const originalDir = path.dirname(current.filePath)
    const support = path.join(originalDir, 'support.md')
    fs.writeFileSync(support, '# Support')
    const original = fs.readFileSync(current.filePath)
    await app.evaluate(
      (_electron, { originalDir, conflict }) => {
        const fs = process.getBuiltinModule('node:fs')
        const path = process.getBuiltinModule('node:path')
        const remove = fs.promises.rm.bind(fs.promises)
        fs.promises.rm = async (target, options) => {
          if (!target.startsWith(path.join(path.dirname(originalDir), '.uninstall-fixture.removing-'))) return remove(target, options)
          fs.promises.rm = remove
          if (conflict) {
            fs.mkdirSync(originalDir)
            fs.writeFileSync(path.join(originalDir, 'SKILL.md'), '# New occupant')
          } else {
            fs.unlinkSync(path.join(target, 'support.md'))
          }
          throw new Error('Synthetic interrupted uninstall')
        }
      },
      { originalDir, conflict },
    )
    hub = await openHub(page, false)
    await confirm(page, hub)
    const status = conflict ? 'esistono sia l’originale sia la copia temporanea' : 'è incompleta o è stata modificata'
    await hub.getByText(status, { exact: false }).waitFor()
    const state = conflict ? 'conflict' : 'incomplete'
    const readIssue = () =>
      page.evaluate(async (state) => (await window.electronAPI.listSkillUninstallRecoveries({})).find((entry) => entry.state === state), state)
    const issue = await readIssue()
    const receipt = fs.readFileSync(issue.receiptPath)
    await hub.getByText(`Ricevuta — ${issue.receiptPath}`, { exact: true }).waitFor()
    await hub.getByText(`Copia temporanea — ${issue.stagedPath}`, { exact: true }).waitFor()
    await app.close()
    app = undefined
    page = await launch()
    hub = await openHub(page, false, false)
    const recovery = hub.getByRole('listitem').filter({ hasText: issue.receiptPath })
    await recovery.getByText(status, { exact: false }).waitFor()
    const opened = path.join(evidence, `opened-${state}.txt`)
    await app.evaluate(({ shell }, opened) => {
      shell.openPath = async (target) => {
        process.getBuiltinModule('node:fs').writeFileSync(opened, target, { flag: 'wx' })
        return ''
      }
    }, opened)
    await recovery.getByRole('button', { name: 'Apri cartella di recupero' }).click()
    await app.evaluate(async (_electron, opened) => {
      const fs = process.getBuiltinModule('node:fs')
      for (let attempt = 0; attempt < 100 && !fs.existsSync(opened); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }, opened)
    assert.equal(fs.readFileSync(opened, 'utf8'), path.dirname(issue.receiptPath))
    assert.deepEqual(await readIssue(), issue)
    assert.deepEqual(fs.readFileSync(issue.receiptPath), receipt)
    assert.deepEqual(fs.readFileSync(path.join(issue.stagedPath, 'SKILL.md')), original)
    if (conflict) {
      assert.equal(fs.readFileSync(current.filePath, 'utf8'), '# New occupant')
      assert.equal(fs.readFileSync(path.join(issue.stagedPath, 'support.md'), 'utf8'), '# Support')
    } else {
      assert.equal(fs.existsSync(originalDir), false)
    }
    await page.screenshot({ path: path.join(evidence, `recovery-${state}.png`) })
    report.checks.push(`Recovery for ${state} is visible immediately and after restart, opens the receipt folder and preserves retained bytes`)
    await app.close()
    app = undefined
    page = await launch()
  }
  assert.equal(fs.readFileSync(audit, 'utf8'), '')
  report.passed = true
} finally {
  if (app) await app.close()
  fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  retainFixture(evidence)
  console.log(JSON.stringify({ ...report, evidence }, null, 2))
}
