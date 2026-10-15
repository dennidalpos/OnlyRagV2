import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-coding-history-'))
const userData = path.join(scratch, 'user-data')
const workspace = path.join(scratch, 'workspace')
const historyFile = path.join(workspace, '.onlyrag', 'sessions', 'history.json')
fs.mkdirSync(userData)
fs.mkdirSync(workspace)
fs.writeFileSync(
  path.join(userData, 'settings.json'),
  JSON.stringify({ version: 2, settings: { defaultModel: 'offline-test:latest', language: 'en', hasCompletedInitialSetup: true } }),
)

const session = {
  id: 'isolated-coding-history',
  workspacePath: workspace,
  title: 'Durability probe',
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
  actionLogs: [{ id: 'first', timestamp: '2026-10-15T00:00:00.000Z', type: 'info', message: 'First retained step' }],
  executedPrompts: [],
}

let application
let complete = false
async function launch() {
  application = await electron.launch({
    executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [path.join(root, 'dist-electron', 'main.js'), '--disable-gpu'],
    cwd: root,
    env: { ...process.env, ONLYRAG_E2E_TEST: '1', ONLYRAG_E2E_USER_DATA: userData, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
    timeout: 30_000,
  })
  const page = await application.firstWindow()
  await page.waitForFunction(() => Boolean(window.electronAPI?.listCodingSessions && window.electronAPI?.saveCodingSession), undefined, { timeout: 20_000 })
  return page
}

async function readback(page, expectedLogs) {
  const sessions = await page.evaluate((workspacePath) => window.electronAPI.listCodingSessions({ workspacePath }), workspace)
  const stored = sessions.find((item) => item.id === session.id)
  assert(stored, 'Acknowledged session missing after restart')
  assert.deepEqual(
    stored.actionLogs.map((item) => item.message),
    expectedLogs,
  )
  const file = JSON.parse(fs.readFileSync(historyFile, 'utf8'))
  assert.deepEqual(
    file.sessions.find((item) => item.id === session.id).actionLogs.map((item) => item.message),
    expectedLogs,
  )
}

async function waitForExit(pid) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Owned Main process ${pid} did not exit`)
}

try {
  let page = await launch()
  assert((await page.evaluate((value) => window.electronAPI.saveCodingSession(value), session))?.id === session.id)
  let pid = await application.evaluate(() => process.pid)
  await application.close()
  application = undefined
  await waitForExit(pid)

  page = await launch()
  await readback(page, ['First retained step'])
  const updated = {
    ...session,
    updatedAt: '2026-10-15T00:01:00.000Z',
    actionLogs: [...session.actionLogs, { id: 'second', timestamp: '2026-10-15T00:01:00.000Z', type: 'info', message: 'Second retained step' }],
  }
  assert((await page.evaluate((value) => window.electronAPI.saveCodingSession(value), updated))?.id === session.id)
  pid = await application.evaluate(() => process.pid)
  process.kill(pid, 'SIGKILL')
  application = undefined
  await waitForExit(pid)

  page = await launch()
  await readback(page, ['First retained step', 'Second retained step'])
  const repairedHistory = fs.readFileSync(historyFile)
  const unsaved = {
    ...session,
    updatedAt: '2026-10-15T00:02:00.000Z',
    actionLogs: [...updated.actionLogs, { id: 'third', timestamp: '2026-10-15T00:02:00.000Z', type: 'info', message: 'Recovered retained step' }],
  }
  assert.equal(await page.evaluate((value) => window.electronAPI.stageCodingSession(value), unsaved), true)
  fs.writeFileSync(historyFile, '{unreadable')
  await assert.rejects(page.evaluate((value) => window.electronAPI.saveCodingSession(value), unsaved))
  pid = await application.evaluate(() => process.pid)
  await application.close()
  application = undefined
  await waitForExit(pid)
  fs.writeFileSync(historyFile, repairedHistory)

  page = await launch()
  const recovery = await page.evaluate(() => window.electronAPI.listCodingHistoryRecovery())
  assert.equal(recovery.length, 1)
  assert.equal(recovery[0].sessionId, session.id)
  const exportDirectory = path.join(scratch, 'recovery-export')
  fs.mkdirSync(exportDirectory)
  const exported = await page.evaluate(
    ({ recoveryId, destinationDirectory }) => window.electronAPI.actOnCodingHistoryRecovery({ recoveryId, action: 'export', destinationDirectory }),
    { recoveryId: recovery[0].recoveryId, destinationDirectory: exportDirectory },
  )
  assert.equal(exported.status, 'complete')
  assert.equal(JSON.parse(fs.readFileSync(exported.exportPath, 'utf8')).session.actionLogs.length, 3)
  const retried = await page.evaluate((recoveryId) => window.electronAPI.actOnCodingHistoryRecovery({ recoveryId, action: 'retry' }), recovery[0].recoveryId)
  assert.equal(retried.status, 'complete')
  await readback(page, ['First retained step', 'Second retained step', 'Recovered retained step'])
  assert.deepEqual(await page.evaluate(() => window.electronAPI.listCodingHistoryRecovery()), [])
  pid = await application.evaluate(() => process.pid)
  await application.close()
  application = undefined
  await waitForExit(pid)
  complete = true
  console.log('PASS: acknowledged history survives close and Main termination; refused history exports and retries after restart')
} finally {
  if (application) await application.close().catch(() => undefined)
  if (complete) {
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        fs.rmSync(scratch, { recursive: true })
        break
      } catch (error) {
        if (attempt === 7) {
          process.exitCode = 1
          console.error(`Could not clean owned probe profile ${scratch}: ${error}`)
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)))
      }
    }
  } else console.error(`Retained failed probe profile: ${scratch}`)
}
