import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-agent-lifecycle-'))
const userData = path.join(tempRoot, 'user-data')
const workspace = path.join(tempRoot, 'workspace with spaces')
const model = 'qwen2.5-coder:7b'
const behaviors = []
const pending = new Set()
let chatCount = 0
let fixtureError
let application

// Explicit loopback model fixture; the production Main, IPC, queue, transport and writer run.
const server = http.createServer(async (request, response) => {
  try {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const body = raw ? JSON.parse(raw) : {}
    let result
    if (request.url === '/api/tags') {
      result = {
        models: [
          {
            name: model,
            model,
            digest: 'lifecycle-fixture',
            size: 1000000,
            capabilities: ['completion', 'tools'],
            details: { context_length: 32768, parameter_size: '7B', quantization_level: 'Q4_K_M', family: 'qwen2' },
          },
        ],
      }
    } else if (request.url === '/v1/models') result = { object: 'list', data: [{ id: model, object: 'model', owned_by: 'ollama' }] }
    else if (request.url === '/api/ps') result = { models: [] }
    else if (request.url === '/api/show') result = { details: { context_length: 32768 }, model_info: { 'qwen2.context_length': 32768 } }
    else if (request.url === '/api/generate') result = { done: true }
    else if (request.url === '/api/chat') {
      assert(!body.format, 'Unexpected structured request in lifecycle fixture')
      chatCount++
      const behavior = behaviors.shift()
      assert(behavior, 'Unexpected generation after renderer loss or quit')
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      if (behavior === 'hold') {
        response.flushHeaders()
        pending.add(response)
        response.once('close', () => pending.delete(response))
        return
      }
      response.end(
        JSON.stringify({
          model,
          message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'write_file', arguments: behavior } }] },
          done: true,
          done_reason: 'stop',
        }) + '\n',
      )
      return
    } else throw new Error(`Unexpected fixture route: ${request.url}`)
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(result))
  } catch (error) {
    fixtureError = error
    if (!response.headersSent) response.writeHead(500)
    response.end('Lifecycle fixture failed')
  }
})

async function until(predicate, label) {
  const deadline = Date.now() + 20000
  while (!predicate() && Date.now() < deadline) {
    if (fixtureError) throw fixtureError
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert(predicate(), label)
}

function identity(label) {
  return {
    runId: `${label}-${randomUUID()}`,
    conversationId: `${label}-${randomUUID()}`,
    planRevisionId: `${label}:v1`,
    workspaceId: createHash('sha256').update(workspace).digest('hex'),
  }
}

function statePath(run) {
  const key = createHash('sha256').update(run.conversationId).digest('hex')
  return path.join(workspace, '.onlyrag', 'sessions', key, 'state.json')
}

function readState(run) {
  const file = statePath(run)
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
}

async function observe(page) {
  await page.waitForFunction(() => Boolean(window.electronAPI))
  await page.evaluate(() => {
    window.__lifecycleApprovals = []
    window.electronAPI.onAgentApprovalRequest((event) => window.__lifecycleApprovals.push(event))
  })
}

async function launch() {
  application = await electron.launch({
    executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [path.join(tempRoot, 'bootstrap.cjs'), '--disable-gpu'],
    cwd: root,
    env: { ...process.env, ONLYRAG_E2E_TEST: '1', ONLYRAG_E2E_USER_DATA: userData, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
    timeout: 30000,
  })
  const page = await application.firstWindow()
  await observe(page)
  return page
}

let settings
async function start(page, run, agentMode = 'auto') {
  const result = await page.evaluate((payload) => window.electronAPI.startAgentTask(payload), {
    identity: run,
    sessionId: run.conversationId,
    workspacePath: workspace,
    userTask: 'Write the requested fixture file and continue.',
    agentMode,
    activeModel: model,
    settings,
  })
  assert.equal(result.success, true, JSON.stringify(result))
  return result
}

async function crash(run) {
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer())
  await until(() => readState(run)?.completionStatus === 'cancelled' && pending.size === 0, 'Crash did not cancel and persist the owned run')
  assert.equal(readState(run).terminationReason, 'cancelled')
  assert.equal(readState(run).status, 'FAILED')
}

async function restart() {
  await application.close()
  application = undefined
  const page = await launch()
  const status = await page.evaluate(() => window.electronAPI.getAgentQueueStatus())
  assert.equal(status.runningCount, 0)
  assert.equal(status.queuedCount, 0)
  return page
}

try {
  fs.mkdirSync(userData)
  fs.mkdirSync(workspace)
  const isolatedTemp = path.join(tempRoot, 'app-temp')
  fs.mkdirSync(isolatedTemp)
  fs.writeFileSync(
    path.join(tempRoot, 'bootstrap.cjs'),
    `require('electron').app.setPath('temp', ${JSON.stringify(isolatedTemp)})\nrequire(${JSON.stringify(path.join(root, 'dist-electron', 'main.js'))})\n`,
  )
  fs.writeFileSync(path.join(workspace, 'README.md'), '# Isolated lifecycle fixture\n')
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  settings = {
    language: 'en',
    hasCompletedInitialSetup: true,
    defaultModel: model,
    codingModel: model,
    ollamaHost: `http://127.0.0.1:${server.address().port}`,
    modelContextLengths: { [model]: 8192 },
    allowTerminalExecution: true,
    allowFileModifications: true,
    capabilityPolicyMode: 'network-approved',
    maxToolCallSteps: 10,
    enableSkillRouter: false,
    verifyBeforeFinish: false,
  }
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ version: 2, settings }))
  let page = await launch()

  const streamRun = identity('crash-stream')
  const queued = identity('crash-queued')
  behaviors.push({ filePath: 'retained.txt', content: 'Retain this owned edit.' }, 'hold')
  await start(page, streamRun)
  await until(() => pending.size === 1, 'Expected the real transport to hold a stream')
  assert.equal(fs.readFileSync(path.join(workspace, 'retained.txt'), 'utf8'), 'Retain this owned edit.')
  assert.equal((await start(page, queued)).queuePosition, 1)
  const requestsBeforeCrash = chatCount
  await crash(streamRun)
  page = await restart()
  assert.equal(chatCount, requestsBeforeCrash)
  assert.equal(readState(queued), null, 'Queued run unexpectedly started')
  assert.equal(fs.readFileSync(path.join(workspace, 'retained.txt'), 'utf8'), 'Retain this owned edit.')
  const checkpoints = path.join(workspace, '.onlyrag', 'checkpoints')
  assert(fs.existsSync(checkpoints) && fs.readdirSync(checkpoints).length > 0, 'Owned edit checkpoint was not retained')
  console.log('PASS renderer crash: stream cancelled, queue removed, edit/checkpoint retained')

  const approvalRun = identity('crash-approval')
  behaviors.push({ filePath: 'forbidden.txt', content: 'Do not write without approval.' })
  await start(page, approvalRun, 'guided')
  await page.waitForFunction((id) => window.__lifecycleApprovals.some((event) => event.runId === id), approvalRun.runId)
  await crash(approvalRun)
  page = await restart()
  assert(!fs.existsSync(path.join(workspace, 'forbidden.txt')))
  assert.equal(await page.evaluate((run) => window.electronAPI.respondToAgentApproval({ identity: run, approved: true }), approvalRun), false)
  console.log('PASS renderer crash: approval denied and stale approval refused')

  const quitRun = identity('quit-stream')
  const quitQueued = identity('quit-queued')
  behaviors.push('hold')
  await start(page, quitRun)
  await until(() => pending.size === 1, 'Expected a stream before quit')
  await start(page, quitQueued)
  const ownedProcess = application.process()
  const exited = new Promise((resolve) => ownedProcess.once('exit', resolve))
  await application.evaluate(({ app }) => {
    app.quit()
    app.quit()
  })
  let exitTimer
  await Promise.race([
    exited,
    new Promise((_, reject) => {
      exitTimer = setTimeout(() => reject(new Error('Owned app failed bounded quit')), 15000)
    }),
  ]).finally(() => clearTimeout(exitTimer))
  application = undefined
  assert.equal(ownedProcess.exitCode, 0)
  assert.equal(readState(quitRun)?.completionStatus, 'cancelled')
  assert.equal(readState(quitRun)?.terminationReason, 'cancelled')
  assert.equal(readState(quitQueued), null)
  await until(() => pending.size === 0, 'Quit did not close the owned generation')
  const requestsBeforeRestart = chatCount
  page = await launch()
  const status = await page.evaluate(() => window.electronAPI.getAgentQueueStatus())
  assert.equal(status.runningCount + status.queuedCount, 0)
  assert.equal(chatCount, requestsBeforeRestart, 'Restart resumed a cancelled/queued run automatically')
  assert.equal(readState(quitRun)?.completionStatus, 'cancelled')
  assert.equal(fs.readFileSync(path.join(workspace, 'retained.txt'), 'utf8'), 'Retain this owned edit.')
  if (fixtureError) throw fixtureError
  console.log('PASS repeated quit/restart: interrupted-state readback and no automatic resume')
} finally {
  if (application) await application.close()
  for (const response of pending) response.destroy()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  const resolved = path.resolve(tempRoot)
  assert(resolved.toLowerCase().startsWith(`${path.resolve(os.tmpdir())}${path.sep}`.toLowerCase()))
  assert(path.basename(resolved).startsWith('onlyrag-agent-lifecycle-'))
  fs.rmSync(resolved, { recursive: true, force: true })
}
