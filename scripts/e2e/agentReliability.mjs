import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const mainBundle = path.join(rootDir, 'dist-electron', 'main.js')
const electronExe = path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron.exe')
const model = 'qwen2.5-coder:7b'
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-electron-e2e-'))
const userData = path.join(tempRoot, 'user-data')
const workspaceRoot = path.join(tempRoot, 'workspace with spaces')
const secondWorkspace = path.join(tempRoot, 'second-workspace')
const legacyWorkspace = path.join(tempRoot, 'legacy-workspace')

fs.mkdirSync(workspaceRoot, { recursive: true })
fs.mkdirSync(secondWorkspace, { recursive: true })
fs.mkdirSync(path.join(legacyWorkspace, '.onlyrag', 'sessions'), { recursive: true })
fs.mkdirSync(path.join(legacyWorkspace, '.onlyrag', 'assistant'), { recursive: true })
fs.writeFileSync(path.join(workspaceRoot, 'README.md'), '# Electron E2E\n', 'utf8')
fs.writeFileSync(path.join(secondWorkspace, 'README.md'), '# Second project\n', 'utf8')
const legacySessionId = 'legacy-chat'
const legacyHistory = JSON.stringify({ version: 1, sessions: [{ id: legacySessionId, workspacePath: legacyWorkspace, title: 'Legacy chat' }] })
const legacyState = JSON.stringify({ sessionId: legacySessionId, agentMode: 'guided' })
const legacyTracker = '# SESSION_TRACKER\n## completed_tasks\n- [x] Legacy work'
fs.writeFileSync(path.join(legacyWorkspace, '.onlyrag', 'sessions', 'session_history.json'), legacyHistory, 'utf8')
fs.writeFileSync(path.join(legacyWorkspace, '.onlyrag', 'sessions', '.agent_state_legacy-chat.json'), legacyState, 'utf8')
fs.writeFileSync(path.join(legacyWorkspace, '.onlyrag', 'assistant', 'SESSION_TRACKER.md'), legacyTracker, 'utf8')

const serverState = {
  installedModels: [model],
  chatBehaviors: [],
  pendingResponses: new Set(),
  requestCount: 0,
  chatRequests: [],
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      raw += chunk
    })
    request.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

function sendChatLine(response, message) {
  if (!response.headersSent) response.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
  response.end(
    `${JSON.stringify({
      model,
      message,
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 24,
      prompt_eval_duration: 1_000_000,
      eval_count: 12,
      eval_duration: 1_000_000,
    })}\n`,
  )
}

function releasePendingResponses() {
  for (const response of serverState.pendingResponses) {
    if (!response.destroyed) sendChatLine(response, { role: 'assistant', content: 'Released after cancellation.' })
  }
  serverState.pendingResponses.clear()
}

async function waitForHeldResponse() {
  const deadline = Date.now() + 20_000
  while (serverState.pendingResponses.size === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert(serverState.pendingResponses.size > 0, 'Expected an active held model response')
  return serverState.pendingResponses.values().next().value
}

const ollamaServer = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1')
  if (request.method === 'GET' && url.pathname === '/api/tags') {
    sendJson(response, 200, {
      models: serverState.installedModels.map((name) => ({
        name,
        model: name,
        digest: 'e2e-digest',
        size: 1_000_000,
        capabilities: ['completion', 'tools'],
        details: { context_length: 32768, parameter_size: '7B', quantization_level: 'Q4_K_M', family: 'qwen2' },
      })),
    })
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/ps') {
    sendJson(response, 200, { models: [] })
    return
  }

  const body = await readJsonBody(request)
  if (request.method === 'POST' && url.pathname === '/api/show') {
    sendJson(response, 200, { details: { context_length: 32768 }, model_info: { 'qwen2.context_length': 32768 } })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/generate') {
    if (!body.prompt) {
      sendJson(response, 200, { done: true })
      return
    }
    response.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
    response.end(`${JSON.stringify({ model, response: 'Read-only answer.', done: true, done_reason: 'stop', context: [1, 2, 3] })}\n`)
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/chat') {
    // Structured requests (interview, plan) carry a JSON schema in `format`; agent turns never do.
    if (body.format) {
      sendJson(response, 200, { message: { role: 'assistant', content: '{}' }, done: true, done_reason: 'stop' })
      return
    }
    serverState.requestCount++
    serverState.chatRequests.push(body)
    const behavior = serverState.chatBehaviors.shift() || { type: 'prose' }
    if (behavior.type === 'hold') {
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      serverState.pendingResponses.add(response)
      response.on('close', () => serverState.pendingResponses.delete(response))
      return
    }
    if (behavior.type === 'tool') {
      sendChatLine(response, {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: behavior.name, arguments: behavior.arguments } }],
      })
      return
    }
    sendChatLine(response, { role: 'assistant', content: behavior.content || 'Read-only answer.' })
    return
  }
  sendJson(response, 404, { error: `Unhandled fake Ollama route: ${request.method} ${url.pathname}` })
})

await new Promise((resolve) => ollamaServer.listen(0, '127.0.0.1', resolve))
const address = ollamaServer.address()
assert(address && typeof address === 'object')
const ollamaHost = `http://127.0.0.1:${address.port}`

const settings = {
  defaultModel: model,
  codingModel: model,
  translationModel: model,
  visionModel: model,
  embeddingModel: model,
  ocrEngine: 'native_cuda',
  ollamaHost,
  allowTerminalExecution: true,
  allowFileModifications: true,
  capabilityPolicyMode: 'network-approved',
  maxToolCallSteps: 10,
  enableSkillRouter: false,
  customPromptOverrides: {},
}

function identity(label, workspacePath = workspaceRoot) {
  return {
    runId: `e2e-${label}-${randomUUID()}`,
    conversationId: `conversation-${label}-${randomUUID()}`,
    planRevisionId: `plan-${label}:v1`,
    workspaceId: createHash('sha256').update(workspacePath).digest('hex'),
  }
}

async function launchApplication() {
  const application = await electron.launch({
    executablePath: electronExe,
    args: [mainBundle, '--disable-gpu'],
    cwd: rootDir,
    env: {
      ...process.env,
      ONLYRAG_E2E_TEST: '1',
      ONLYRAG_E2E_USER_DATA: userData,
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    },
    timeout: 30_000,
  })
  const page = await application.firstWindow()
  await page.waitForFunction(() => Boolean(window.electronAPI), undefined, { timeout: 20_000 })
  await page.evaluate(() => {
    window.__onlyragE2E = { logs: [], steps: [], done: [], approvals: [] }
    window.electronAPI.onAgentLog((event) => window.__onlyragE2E.logs.push(event))
    window.electronAPI.onAgentStepUpdate?.((event) => window.__onlyragE2E.steps.push(event))
    window.electronAPI.onAgentDone((event) => window.__onlyragE2E.done.push(event))
    window.electronAPI.onAgentApprovalRequest((event) => window.__onlyragE2E.approvals.push(event))
  })
  return { application, page }
}

/** Calls one `window.electronAPI` method with its single object payload (or none). */
async function api(page, method, payload) {
  return page.evaluate(({ methodName, argument }) => (argument === undefined ? window.electronAPI[methodName]() : window.electronAPI[methodName](argument)), {
    methodName: method,
    argument: payload,
  })
}

async function waitForStep(page, runId, statusText) {
  try {
    await page.waitForFunction(
      ({ expectedRunId, expectedStatus }) => window.__onlyragE2E.steps.some((event) => event.runId === expectedRunId && event.statusText === expectedStatus),
      { expectedRunId: runId, expectedStatus: statusText },
      { timeout: 20_000 },
    )
  } catch (error) {
    const diagnostics = await page.evaluate(
      (expectedRunId) => ({
        steps: window.__onlyragE2E.steps.filter((event) => event.runId === expectedRunId),
        logs: window.__onlyragE2E.logs.filter((event) => event.runId === expectedRunId),
      }),
      runId,
    )
    throw new Error(`Timed out waiting for phase '${statusText}' in ${runId}: ${JSON.stringify(diagnostics)}`, { cause: error })
  }
}

async function waitForDone(page, runId, timeout = 20_000) {
  await page.waitForFunction((expectedRunId) => window.__onlyragE2E.done.some((event) => event.runId === expectedRunId), runId, { timeout })
  return page.evaluate((expectedRunId) => window.__onlyragE2E.done.find((event) => event.runId === expectedRunId), runId)
}

async function waitForQueueIdle(page) {
  await page.waitForFunction(
    async () => {
      const status = await window.electronAPI.getAgentQueueStatus()
      return status.runningCount === 0 && status.queuedCount === 0
    },
    undefined,
    { timeout: 20_000 },
  )
}

async function startTask(page, runIdentity, overrides = {}) {
  return api(page, 'startAgentTask', {
    identity: runIdentity,
    sessionId: runIdentity.conversationId,
    userTask: 'Inspect README.md and answer briefly.',
    initialUserTask: 'Inspect README.md and answer briefly.',
    agentMode: 'ask',
    workspacePath: workspaceRoot,
    isStandaloneMode: false,
    activeModel: model,
    settings,
    capabilityProfile: {
      allowTerminalExecution: true,
      allowFileModifications: true,
      capabilityPolicyMode: 'network-approved',
      maxToolCallSteps: 10,
    },
    ...overrides,
  })
}

function assertSafeTempRoot() {
  const resolved = path.resolve(tempRoot)
  const tempBase = `${path.resolve(os.tmpdir())}${path.sep}`.toLowerCase()
  assert(resolved.toLowerCase().startsWith(tempBase), `Refusing to clean non-temporary path: ${resolved}`)
  assert(path.basename(resolved).startsWith('onlyrag-electron-e2e-'))
}

let application
let page
try {
  assert(fs.existsSync(mainBundle), `Missing Electron bundle: ${mainBundle}`)
  assert(fs.existsSync(electronExe), `Missing Electron executable: ${electronExe}`)
  ;({ application, page } = await launchApplication())

  console.log('[1/8] project and session switching, layout migration and removal')
  await api(page, 'registerProject', { projectPath: workspaceRoot, name: 'Workspace One' })
  await api(page, 'registerProject', { projectPath: secondWorkspace, name: 'Workspace Two' })
  const now = new Date().toISOString()
  await api(page, 'saveCodingSession', {
    id: 'session-one',
    workspacePath: workspaceRoot,
    title: 'One',
    createdAt: now,
    updatedAt: now,
    actionLogs: [],
    executedPrompts: [],
  })
  await api(page, 'saveCodingSession', {
    id: 'session-two',
    workspacePath: secondWorkspace,
    title: 'Two',
    createdAt: now,
    updatedAt: now,
    actionLogs: [],
    executedPrompts: [],
  })
  assert.deepEqual(
    (await api(page, 'listCodingSessions', { workspacePath: workspaceRoot })).map((entry) => entry.id),
    ['session-one'],
  )
  assert.deepEqual(
    (await api(page, 'listCodingSessions', { workspacePath: secondWorkspace })).map((entry) => entry.id),
    ['session-two'],
  )
  assert.equal((await api(page, 'touchProject', { projectPath: workspaceRoot })).path, workspaceRoot)
  assert.equal((await api(page, 'touchProject', { projectPath: secondWorkspace })).path, secondWorkspace)

  const metadata = path.join(workspaceRoot, '.onlyrag')
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(metadata, 'layout.json'), 'utf8')), { version: 2 })
  assert.match(fs.readFileSync(path.join(metadata, '.gitignore'), 'utf8'), /\*/)
  const sessionDir = (sessionId) => path.join(metadata, 'sessions', createHash('sha256').update(sessionId).digest('hex'))
  await api(page, 'saveCodingSession', {
    id: 'session-kept',
    workspacePath: workspaceRoot,
    title: 'Kept',
    createdAt: now,
    updatedAt: now,
    actionLogs: [],
    executedPrompts: [],
  })
  for (const sessionId of ['session-one', 'session-kept']) {
    fs.mkdirSync(sessionDir(sessionId), { recursive: true })
    fs.writeFileSync(path.join(sessionDir(sessionId), 'state.json'), JSON.stringify({ sessionId }), 'utf8')
    fs.writeFileSync(path.join(sessionDir(sessionId), 'SESSION_TRACKER.md'), `# ${sessionId}`, 'utf8')
  }
  assert.equal(await api(page, 'deleteCodingSession', { sessionId: 'session-one', workspacePath: workspaceRoot }), true)
  assert.equal(fs.existsSync(sessionDir('session-one')), false)
  assert.equal(fs.readFileSync(path.join(sessionDir('session-kept'), 'SESSION_TRACKER.md'), 'utf8'), '# session-kept')
  assert.deepEqual(
    (await api(page, 'listCodingSessions', { workspacePath: workspaceRoot })).map((entry) => entry.id),
    ['session-kept'],
  )

  assert.equal(await api(page, 'removeProjectFromRegistry', { projectPath: workspaceRoot }), true)
  assert.equal(
    (await api(page, 'listProjects')).some((project) => project.path === workspaceRoot),
    false,
  )
  assert.equal(fs.existsSync(path.join(metadata, 'layout.json')), true)
  assert.equal(fs.existsSync(path.join(workspaceRoot, 'README.md')), true)
  await api(page, 'registerProject', { projectPath: workspaceRoot, name: 'Reopened Workspace' })
  assert.equal((await api(page, 'listProjects')).find((project) => project.path === workspaceRoot)?.name, 'Reopened Workspace')
  assert.deepEqual(
    (await api(page, 'listCodingSessions', { workspacePath: workspaceRoot })).map((entry) => entry.id),
    ['session-kept'],
  )

  await api(page, 'registerProject', { projectPath: legacyWorkspace, name: 'Legacy Workspace' })
  assert.deepEqual(
    (await api(page, 'listCodingSessions', { workspacePath: legacyWorkspace })).map((entry) => entry.id),
    [legacySessionId],
  )

  const capturedProfile = {
    allowTerminalExecution: true,
    allowFileModifications: true,
    fullAccess: true,
    capabilityPolicyMode: 'network-approved',
    maxToolCallSteps: 10,
  }
  await api(page, 'saveCodingSession', {
    id: 'ready-plan-chat',
    workspacePath: workspaceRoot,
    title: 'Ready plan',
    createdAt: now,
    updatedAt: now,
    actionLogs: [],
    executedPrompts: [],
    plans: [
      {
        formatVersion: 2,
        id: 'ready-plan',
        version: 1,
        prompt: 'Create a local app',
        objective: 'Create a local app',
        decisions: [],
        retainedEvidence: [],
        supersededWork: [],
        milestones: [],
        status: 'ready',
        createdAt: now,
        capabilityProfile: capturedProfile,
      },
    ],
  })
  const restoredPlan = (await api(page, 'listCodingSessions', { workspacePath: workspaceRoot })).find((entry) => entry.id === 'ready-plan-chat')?.plans?.[0]
  assert.deepEqual(restoredPlan?.capabilityProfile, capturedProfile)
  const legacyMetadata = path.join(legacyWorkspace, '.onlyrag')
  const migratedSession = path.join(legacyMetadata, 'sessions', createHash('sha256').update(legacySessionId).digest('hex'))
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(legacyMetadata, 'layout.json'), 'utf8')), { version: 2 })
  assert.equal(fs.readFileSync(path.join(migratedSession, 'state.json'), 'utf8'), legacyState)
  assert.equal(fs.readFileSync(path.join(migratedSession, 'SESSION_TRACKER.md'), 'utf8'), legacyTracker)
  assert.equal(fs.readFileSync(path.join(legacyMetadata, 'migration-backup', 'v1', 'sessions', 'session_history.json'), 'utf8'), legacyHistory)
  assert.equal(fs.readFileSync(path.join(legacyMetadata, 'migration-backup', 'v1', 'sessions', '.agent_state_legacy-chat.json'), 'utf8'), legacyState)
  assert.equal(fs.existsSync(path.join(legacyMetadata, 'sessions', 'session_history.json')), false)
  assert.deepEqual(
    (await api(page, 'listCodingSessions', { workspacePath: legacyWorkspace })).map((entry) => entry.id),
    [legacySessionId],
  )

  console.log('[2/8] stale saves, spaced paths, and symlink escapes')
  const spacedFile = path.join(workspaceRoot, 'folder with spaces', 'note file.txt')
  fs.mkdirSync(path.dirname(spacedFile), { recursive: true })
  fs.writeFileSync(spacedFile, 'version one', 'utf8')
  const read = await api(page, 'readWorkspaceFile', { filePath: spacedFile })
  assert.equal(read.success, true)
  fs.writeFileSync(spacedFile, 'external version', 'utf8')
  const stale = await api(page, 'writeWorkspaceFile', {
    filePath: spacedFile,
    content: 'stale editor version',
    expectedContentHash: read.contentHash,
    workspaceRoot,
  })
  assert.equal(stale.success, false)
  assert.equal(stale.conflict, true)
  assert.equal(fs.readFileSync(spacedFile, 'utf8'), 'external version')
  const outside = path.join(tempRoot, 'outside')
  const escape = path.join(workspaceRoot, 'escape-link')
  fs.mkdirSync(outside, { recursive: true })
  fs.symlinkSync(outside, escape, process.platform === 'win32' ? 'junction' : 'dir')
  const escapedWrite = await api(page, 'writeWorkspaceFile', { filePath: path.join(escape, 'blocked.txt'), content: 'blocked', workspaceRoot })
  assert.equal(escapedWrite.success, false)
  assert.match(escapedWrite.error || '', /Symlink or junction escape blocked/i)
  assert.equal(fs.existsSync(path.join(outside, 'blocked.txt')), false)

  console.log('[3/8] standalone artifacts')
  const scratchPath = (await api(page, 'getStandaloneScratchWorkspace')).path
  assert.equal(scratchPath, path.join(userData, 'agent-scratch'))
  const artifact = await api(page, 'saveArtifact', {
    workspacePath: scratchPath,
    input: { name: 'standalone-report', kind: 'markdown', content: '# Persisted artifact' },
  })
  assert.equal((await api(page, 'getArtifact', { workspacePath: scratchPath, artifactId: artifact.id })).content, '# Persisted artifact')
  assert((await api(page, 'listArtifacts', { workspacePath: scratchPath })).some((entry) => entry.id === artifact.id))

  console.log('[4/8] missing-model preflight')
  const missingIdentity = identity('missing-model')
  const missingAccepted = await startTask(page, missingIdentity, {
    activeModel: 'missing-model:latest',
    workspacePath: scratchPath,
    isStandaloneMode: true,
  })
  assert.equal(missingAccepted.success, true)
  const missingDone = await waitForDone(page, missingIdentity.runId)
  assert.equal(missingDone.success, false)
  assert.equal(missingDone.completionStatus, 'blocked')
  assert.match(missingDone.summary, /preflight blocked: model/i)
  await waitForQueueIdle(page)

  console.log('[access] restricted, Full access and Ask behavior in an isolated workspace')
  const accessWorkspace = path.join(tempRoot, 'access-workspace')
  const externalFile = path.join(tempRoot, 'external-probe.txt')
  const askFile = path.join(accessWorkspace, 'ask-should-not-write.txt')
  fs.mkdirSync(path.join(accessWorkspace, 'local-pkg'), { recursive: true })
  fs.writeFileSync(path.join(accessWorkspace, 'package.json'), JSON.stringify({ name: 'access-probe', version: '1.0.0', private: true }), 'utf8')
  fs.writeFileSync(path.join(accessWorkspace, 'local-pkg', 'package.json'), JSON.stringify({ name: 'local-probe', version: '1.0.0', main: 'index.js' }), 'utf8')
  fs.writeFileSync(path.join(accessWorkspace, 'local-pkg', 'index.js'), 'module.exports = true\n', 'utf8')
  const accessRun = {
    workspacePath: accessWorkspace,
    agentMode: 'auto',
    userTask: 'Write the temporary probe file and install the local package.',
    initialUserTask: 'Write the temporary probe file and install the local package.',
    capabilityProfile: { ...capturedProfile, fullAccess: false, maxToolCallSteps: 3 },
  }
  serverState.chatBehaviors.push({ type: 'tool', name: 'write_file', arguments: { filePath: externalFile, content: 'restricted' } })
  const restrictedIdentity = identity('restricted-external', accessWorkspace)
  await startTask(page, restrictedIdentity, accessRun)
  await waitForDone(page, restrictedIdentity.runId)
  await waitForQueueIdle(page)
  assert.equal(fs.existsSync(externalFile), false)

  serverState.chatBehaviors.length = 0
  serverState.chatBehaviors.push(
    { type: 'tool', name: 'write_file', arguments: { filePath: externalFile, content: 'full access' } },
    { type: 'tool', name: 'run_command', arguments: { command: 'npm install --offline --ignore-scripts --no-audit --no-fund ./local-pkg' } },
    { type: 'prose', content: 'The temporary probe and local package are ready.' },
  )
  const fullIdentity = identity('full-access', accessWorkspace)
  await startTask(page, fullIdentity, { ...accessRun, capabilityProfile: { ...capturedProfile, maxToolCallSteps: 5 } })
  await waitForDone(page, fullIdentity.runId, 60_000)
  await waitForQueueIdle(page)
  assert.equal(fs.readFileSync(externalFile, 'utf8'), 'full access')
  assert.equal(fs.existsSync(path.join(accessWorkspace, 'node_modules', 'local-probe', 'package.json')), true)
  const accessApprovals = await page.evaluate(
    (runId) => window.__onlyragE2E.logs.filter((event) => event.runId === runId && event.type === 'approval_request'),
    fullIdentity.runId,
  )
  assert.deepEqual(accessApprovals, [])

  serverState.chatBehaviors.length = 0
  serverState.chatBehaviors.push({ type: 'tool', name: 'write_file', arguments: { filePath: askFile, content: 'should fail' } })
  const askIdentity = identity('full-access-ask', accessWorkspace)
  await startTask(page, askIdentity, {
    ...accessRun,
    agentMode: 'ask',
    capabilityProfile: { ...capturedProfile, maxToolCallSteps: 2 },
  })
  await waitForDone(page, askIdentity.runId)
  await waitForQueueIdle(page)
  assert.equal(fs.existsSync(askFile), false)

  console.log('[5/8] queued prompts and targeted cancellation')
  serverState.chatBehaviors.push({ type: 'hold' })
  const firstIdentity = identity('queue-first', scratchPath)
  const secondIdentity = identity('queue-second', scratchPath)
  const standaloneRun = { workspacePath: scratchPath, isStandaloneMode: true }
  assert.equal((await startTask(page, firstIdentity, standaloneRun)).queuePosition, 0)
  await waitForStep(page, firstIdentity.runId, 'Proposta corrente')
  const secondAccepted = await startTask(page, secondIdentity, standaloneRun)
  assert.equal(secondAccepted.queuePosition, 1)
  const queuedStatus = await api(page, 'getAgentQueueStatus')
  assert.equal(queuedStatus.runningCount, 1)
  assert.equal(queuedStatus.queuedCount, 1)
  assert.equal((await api(page, 'cancelAgentTask', secondIdentity)).success, true)
  assert.equal((await api(page, 'cancelAgentTask', firstIdentity)).success, true)
  releasePendingResponses()
  await waitForQueueIdle(page)

  console.log('[6/8] cancellation in each cancellable execution phase')
  const phaseCases = [
    ['collect', 'Raccolta contesto', { type: 'hold' }, {}],
    ['propose', 'Proposta corrente', { type: 'hold' }, {}],
    [
      'apply',
      'Applicazione',
      { type: 'tool', name: 'write_file', arguments: { filePath: 'apply-phase.txt', content: 'not persisted' } },
      {
        userTask: 'Create apply-phase.txt with the provided content.',
        initialUserTask: 'Create apply-phase.txt with the provided content.',
        agentMode: 'guided',
      },
    ],
    [
      'verify',
      'Verifica',
      // The next model call is held so the run is still active when the cancellation arrives.
      [{ type: 'tool', name: 'write_file', arguments: { filePath: 'verify-phase.txt', content: 'temporary' } }, { type: 'hold' }],
      {
        userTask: 'Create verify-phase.txt with the provided content.',
        initialUserTask: 'Create verify-phase.txt with the provided content.',
        agentMode: 'auto',
      },
    ],
  ]
  for (const [label, phase, behavior, overrides] of phaseCases) {
    console.log(`  - ${label}`)
    serverState.chatBehaviors.length = 0
    serverState.chatBehaviors.push(...[behavior].flat())
    const runIdentity = identity(`cancel-${label}`, scratchPath)
    await startTask(page, runIdentity, { ...standaloneRun, ...overrides })
    await waitForStep(page, runIdentity.runId, phase)
    assert.equal((await api(page, 'cancelAgentTask', runIdentity)).success, true)
    releasePendingResponses()
    serverState.chatBehaviors.length = 0
    const done = await waitForDone(page, runIdentity.runId)
    assert.equal(done.completionStatus, 'cancelled')
    await waitForQueueIdle(page)
  }

  console.log('[active-run] mode, context, pending consent and queued identity through Electron IPC')
  serverState.chatBehaviors.length = 0
  serverState.chatBehaviors.push(
    { type: 'tool', name: 'write_file', arguments: { filePath: 'active-run.txt', content: 'mode switched' } },
    { type: 'hold' },
    { type: 'hold' },
  )
  const liveIdentity = identity('active-mode-context', scratchPath)
  const liveFile = path.join(scratchPath, 'active-run.txt')
  const requestStart = serverState.chatRequests.length
  await startTask(page, liveIdentity, {
    workspacePath: scratchPath,
    agentMode: 'guided',
    userTask: 'Create active-run.txt and inspect the workspace.',
    initialUserTask: 'Create active-run.txt and inspect the workspace.',
    settings: { ...settings, modelContextLengths: { [model]: 16384 } },
  })
  await page.waitForFunction((runId) => window.__onlyragE2E.approvals.some((event) => event.runId === runId), liveIdentity.runId, { timeout: 20_000 })
  const guidedApproval = await page.evaluate((runId) => window.__onlyragE2E.approvals.find((event) => event.runId === runId), liveIdentity.runId)
  assert.deepEqual(guidedApproval.reasons, ['guided_review'])
  assert.deepEqual(await api(page, 'updateActiveAgentRun', { identity: liveIdentity, mode: 'auto' }), {
    updated: true,
    approvalResolved: true,
  })
  const heldSecondTurn = await waitForHeldResponse()
  assert.equal(fs.readFileSync(liveFile, 'utf8'), 'mode switched')
  assert.equal(serverState.chatRequests[requestStart].options.num_ctx, 16384)
  assert.equal(serverState.chatRequests[requestStart + 1].options.num_ctx, 16384)
  assert.deepEqual(await api(page, 'updateActiveAgentRun', { identity: liveIdentity, numCtx: 8192 }), {
    updated: true,
    approvalResolved: false,
    numCtx: 8192,
  })
  const queuedIdentityForUpdate = identity('active-update-queued', scratchPath)
  assert.equal((await startTask(page, queuedIdentityForUpdate, { ...standaloneRun })).queuePosition, 1)
  assert.deepEqual(await api(page, 'updateActiveAgentRun', { identity: queuedIdentityForUpdate, mode: 'auto', numCtx: 8192 }), {
    updated: false,
    approvalResolved: false,
  })
  assert.equal((await api(page, 'cancelAgentTask', queuedIdentityForUpdate)).success, true)
  serverState.pendingResponses.delete(heldSecondTurn)
  sendChatLine(heldSecondTurn, { role: 'assistant', content: '', tool_calls: [{ function: { name: 'list_dir', arguments: { path: '.' } } }] })
  await waitForHeldResponse()
  assert.equal(serverState.chatRequests[requestStart + 2].options.num_ctx, 8192)
  assert.equal((await api(page, 'cancelAgentTask', liveIdentity)).success, true)
  releasePendingResponses()
  await waitForDone(page, liveIdentity.runId)
  await waitForQueueIdle(page)
  assert.deepEqual(await api(page, 'updateActiveAgentRun', { identity: liveIdentity, mode: 'guided' }), {
    updated: false,
    approvalResolved: false,
  })

  for (const [label, tool] of [
    ['network', { name: 'download_file', arguments: { url: 'https://example.invalid/file', filePath: 'pending-network.txt' } }],
    ['install', { name: 'run_command', arguments: { command: 'npm install left-pad' } }],
  ]) {
    serverState.chatBehaviors.length = 0
    serverState.chatBehaviors.push({ type: 'tool', ...tool })
    const consentIdentity = identity(`active-consent-${label}`, scratchPath)
    await startTask(page, consentIdentity, {
      workspacePath: scratchPath,
      agentMode: 'guided',
      userTask: `Request ${label} consent.`,
      initialUserTask: `Request ${label} consent.`,
      capabilityProfile: { ...capturedProfile, fullAccess: false },
    })
    await page.waitForFunction((runId) => window.__onlyragE2E.approvals.some((event) => event.runId === runId), consentIdentity.runId, { timeout: 20_000 })
    const consent = await page.evaluate((runId) => window.__onlyragE2E.approvals.find((event) => event.runId === runId), consentIdentity.runId)
    assert(consent.reasons.includes('network_access'))
    assert.equal((await api(page, 'updateActiveAgentRun', { identity: consentIdentity, mode: 'auto' })).approvalResolved, false)
    assert.equal((await api(page, 'cancelAgentTask', consentIdentity)).success, true)
    await waitForDone(page, consentIdentity.runId)
    await waitForQueueIdle(page)
  }

  console.log('[7/8] dirty Git source isolation')
  const gitWorkspace = path.join(tempRoot, 'dirty git workspace')
  fs.mkdirSync(gitWorkspace, { recursive: true })
  fs.writeFileSync(path.join(gitWorkspace, 'tracked.txt'), 'baseline\n', 'utf8')
  execFileSync('git', ['init'], { cwd: gitWorkspace, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'e2e@example.invalid'], { cwd: gitWorkspace })
  execFileSync('git', ['config', 'user.name', 'OnlyRag E2E'], { cwd: gitWorkspace })
  execFileSync('git', ['add', 'tracked.txt'], { cwd: gitWorkspace })
  execFileSync('git', ['commit', '-m', 'baseline'], { cwd: gitWorkspace, stdio: 'ignore' })
  fs.writeFileSync(path.join(gitWorkspace, 'tracked.txt'), 'user dirty change\n', 'utf8')
  const beforeStatus = await api(page, 'getGitStatusAndDiff', { workspaceRoot: gitWorkspace })
  serverState.chatBehaviors.push({ type: 'prose', content: 'The source workspace remains unchanged.' })
  const dirtyIdentity = identity('dirty-git', gitWorkspace)
  await startTask(page, dirtyIdentity, { workspacePath: gitWorkspace })
  const dirtyDone = await waitForDone(page, dirtyIdentity.runId)
  assert.equal(dirtyDone.success, true)
  await waitForQueueIdle(page)
  const afterStatus = await api(page, 'getGitStatusAndDiff', { workspaceRoot: gitWorkspace })
  assert.deepEqual(afterStatus.statusLines, beforeStatus.statusLines)
  assert.equal(fs.readFileSync(path.join(gitWorkspace, 'tracked.txt'), 'utf8'), 'user dirty change\n')

  console.log('[8/8] crash resume with the same immutable run identity')
  serverState.chatBehaviors.push({ type: 'hold' })
  const crashIdentity = identity('crash-resume', scratchPath)
  await startTask(page, crashIdentity, { workspacePath: scratchPath, isStandaloneMode: true })
  await waitForStep(page, crashIdentity.runId, 'Proposta corrente')
  const mainProcess = application.process()
  const exited = new Promise((resolve) => mainProcess.once('exit', resolve))
  if (process.platform === 'win32') {
    execFileSync('taskkill', ['/PID', String(mainProcess.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    mainProcess.kill('SIGKILL')
  }
  await exited
  await application.close().catch(() => {})
  application = undefined
  page = undefined
  releasePendingResponses()
  ;({ application, page } = await launchApplication())
  const persisted = await api(page, 'agentGetPlanState', {
    sessionId: crashIdentity.conversationId,
    workspacePath: scratchPath,
    planRevisionId: crashIdentity.planRevisionId,
  })
  assert(persisted)
  assert.equal(persisted.status, 'IN_PROGRESS')
  assert(persisted.stepCount >= 1)
  serverState.chatBehaviors.push({ type: 'prose', content: 'Resumed after crash.' })
  await startTask(page, crashIdentity, { workspacePath: scratchPath, isStandaloneMode: true })
  const resumedDone = await waitForDone(page, crashIdentity.runId)
  assert.equal(resumedDone.success, true)
  const restoredLog = await page.evaluate(
    (runId) => window.__onlyragE2E.logs.find((event) => event.runId === runId && event.message.includes('Restored Session State')),
    crashIdentity.runId,
  )
  assert(restoredLog)

  console.log('[milestones] restored overlap advances only the first open milestone')
  const overlapIdentity = identity('overlapping-milestones')
  assert.equal(
    await api(page, 'agentPlanSeed', {
      sessionId: overlapIdentity.conversationId,
      workspacePath: workspaceRoot,
      planRevisionId: overlapIdentity.planRevisionId,
      userTask: 'Verify the ordered plan.',
      planMilestones: [
        { id: 'm-1', title: 'Review the project', status: 'in_progress' },
        { id: 'm-2', title: 'Check the result', status: 'in_progress' },
        { id: 'm-3', title: 'Summarize the work', status: 'pending' },
      ],
    }),
    true,
  )
  serverState.chatBehaviors.push(
    { type: 'tool', name: 'update_plan', arguments: { milestoneId: 'm-2', status: 'verified' } },
    { type: 'hold' },
    { type: 'hold' },
  )
  await startTask(page, overlapIdentity, {
    userTask: 'Verify the ordered plan.',
    initialUserTask: 'Verify the ordered plan.',
    agentMode: 'auto',
  })
  const overlapHold = await waitForHeldResponse()
  const overlapBefore = await api(page, 'agentGetPlanState', {
    sessionId: overlapIdentity.conversationId,
    workspacePath: workspaceRoot,
    planRevisionId: overlapIdentity.planRevisionId,
  })
  assert.deepEqual(
    overlapBefore.planMilestones.map(({ status }) => status),
    ['in_progress', 'in_progress', 'pending'],
  )
  serverState.pendingResponses.delete(overlapHold)
  sendChatLine(overlapHold, {
    role: 'assistant',
    content: '',
    tool_calls: [{ function: { name: 'update_plan', arguments: { milestoneId: 'm-1', status: 'verified' } } }],
  })
  await waitForHeldResponse()
  const overlapAfter = await api(page, 'agentGetPlanState', {
    sessionId: overlapIdentity.conversationId,
    workspacePath: workspaceRoot,
    planRevisionId: overlapIdentity.planRevisionId,
  })
  assert.deepEqual(
    overlapAfter.planMilestones.map(({ status }) => status),
    ['verified', 'in_progress', 'pending'],
  )
  assert.equal((await api(page, 'cancelAgentTask', overlapIdentity)).success, true)
  releasePendingResponses()
  await waitForDone(page, overlapIdentity.runId)
  await waitForQueueIdle(page)

  console.log('[tracker] a failed milestone reaches the next desktop model turn')
  const debtIdentity = identity('tracker-unresolved')
  assert.equal(
    await api(page, 'agentPlanSeed', {
      sessionId: debtIdentity.conversationId,
      workspacePath: workspaceRoot,
      planRevisionId: debtIdentity.planRevisionId,
      userTask: 'Report unresolved work.',
      planMilestones: [
        { id: 'm-1', title: 'Check the build', status: 'in_progress' },
        { id: 'm-2', title: 'Write `docs/result.md`', filePaths: ['docs/result.md'], status: 'pending' },
      ],
    }),
    true,
  )
  serverState.chatBehaviors.push(
    { type: 'tool', name: 'update_plan', arguments: { milestoneId: 'm-1', status: 'failed', notes: 'Build command exited with code 1.' } },
    { type: 'hold' },
  )
  await startTask(page, debtIdentity, {
    userTask: 'Report unresolved work.',
    initialUserTask: 'Report unresolved work.',
    agentMode: 'auto',
  })
  await waitForHeldResponse()
  const debtTurn = serverState.chatRequests.at(-1).messages.at(-1).content
  assert.match(debtTurn, /unresolved_issues:\n- \[!\] m-1: Check the build \(Build command exited with code 1\.\)/)
  assert.equal((await api(page, 'cancelAgentTask', debtIdentity)).success, true)
  releasePendingResponses()
  await waitForDone(page, debtIdentity.runId)
  await waitForQueueIdle(page)

  // The reliability scenarios above must finish without any safeguard stopping them.
  const reliabilityDone = await page.evaluate(() => window.__onlyragE2E.done)
  const reliabilityGuards = reliabilityDone.flatMap((event) => event.evidence?.guardEvents || [])
  console.log(`  reliability guards: ${reliabilityGuards.map((event) => `${event.guard}:${event.action}`).join(' ') || 'none'}`)
  const unexpectedStops = reliabilityDone.flatMap((event) => (event.evidence?.guardEvents || []).filter((guardEvent) => guardEvent.action === 'stop'))
  assert.deepEqual(unexpectedStops, [], `Reliability scenarios were stopped by a guard: ${JSON.stringify(unexpectedStops)}`)

  const runGuardScenario = async (label, behaviors, overrides = {}) => {
    serverState.chatBehaviors.length = 0
    serverState.chatBehaviors.push(...behaviors)
    const runIdentity = identity(`guard-${label}`, scratchPath)
    await startTask(page, runIdentity, {
      workspacePath: scratchPath,
      isStandaloneMode: true,
      agentMode: 'auto',
      userTask: 'Update the guard fixture files.',
      initialUserTask: 'Update the guard fixture files.',
      ...overrides,
    })
    const done = await waitForDone(page, runIdentity.runId)
    await waitForQueueIdle(page)
    serverState.chatBehaviors.length = 0
    const guardEvents = done.evidence?.guardEvents || []
    const logs = await page.evaluate(
      (runId) => window.__onlyragE2E.logs.filter((event) => event.runId === runId).map((event) => event.message),
      runIdentity.runId,
    )
    console.log(`  guards: ${guardEvents.map((event) => `${event.guard}:${event.action}@${event.step}`).join(' ') || 'none'} -> ${done.completionStatus}`)
    return { done, guardEvents, logs, stop: guardEvents.filter((event) => event.action === 'stop').map((event) => event.guard) }
  }
  const writeCall = (filePath, content) => ({ type: 'tool', name: 'write_file', arguments: { filePath, content } })
  const fixtureDir = path.join(scratchPath, 'guard-fixtures')
  fs.mkdirSync(fixtureDir, { recursive: true })
  for (let index = 1; index <= 14; index++) fs.writeFileSync(path.join(fixtureDir, `note-${index}.txt`), `note ${index}\n`, 'utf8')
  const describe = (scenario) => JSON.stringify({ events: scenario.guardEvents, logs: scenario.logs })

  console.log('[guard 1/9] prose-only replies while work is open')
  const silence = await runGuardScenario('silence', [
    { type: 'prose', content: 'I will think about it.' },
    { type: 'prose', content: 'Still thinking.' },
    { type: 'prose', content: 'Nothing to do.' },
  ])
  assert.equal(silence.done.success, false)
  assert.deepEqual(silence.stop, ['model_silence'], describe(silence))
  assert.equal(silence.done.completionStatus, 'blocked')
  assert.equal(silence.guardEvents.filter((event) => event.guard === 'model_silence' && event.action === 'advise').length, 2)

  console.log('[guard 2/9] rejected tool calls in a row')
  // Six consecutive failed executions end the run (EXECUTION_RECOVERY_LIMITS); an identical
  // proposal would be intercepted earlier by the loop detector, so each targets another file.
  const escapingWrites = Array.from({ length: 6 }, (_, index) => writeCall(`../outside-scratch-${index + 1}.txt`, 'escape'))
  const rejected = await runGuardScenario('rejected-tool', escapingWrites)
  assert.equal(rejected.done.success, false)
  assert.deepEqual(rejected.stop, ['execution_budget'], describe(rejected))
  assert.equal(rejected.done.completionStatus, 'blocked')
  for (let index = 1; index <= 6; index++) assert(!fs.existsSync(path.join(path.dirname(scratchPath), `outside-scratch-${index}.txt`)))

  console.log('[guard 3/9] the same successful write repeated')
  const sameWrite = writeCall('guard-fixtures/repeated.txt', 'same content\n')
  const repeated = await runGuardScenario(
    'repeated-write',
    Array.from({ length: 12 }, () => sameWrite),
    {
      capabilityProfile: { allowTerminalExecution: true, allowFileModifications: true, capabilityPolicyMode: 'network-approved', maxToolCallSteps: 10 },
    },
  )
  assert.equal(repeated.done.success, false)
  assert(
    repeated.guardEvents.some((event) => event.guard === 'redundant_success'),
    describe(repeated),
  )
  assert.deepEqual(repeated.stop, ['step_budget'], describe(repeated))
  assert.equal(repeated.done.completionStatus, 'blocked')

  console.log('[guard 4/9] writes that change nothing')
  const unchangedWrites = Array.from({ length: 14 }, (_, index) => writeCall(`guard-fixtures/note-${index + 1}.txt`, `note ${index + 1}\n`))
  const unchanged = await runGuardScenario('no-mutation', unchangedWrites, {
    capabilityProfile: { allowTerminalExecution: true, allowFileModifications: true, capabilityPolicyMode: 'network-approved', maxToolCallSteps: 30 },
  })
  assert.equal(unchanged.done.success, false)
  assert.deepEqual(unchanged.stop, ['no_mutation'], describe(unchanged))
  assert.equal(unchanged.done.completionStatus, 'blocked')

  // The guards below never fired in the 67 live snapshots of 2026-09-25; each is kept and driven
  // here by the deterministic model instead (AGENT-GUARD-GROWTH-01).
  const unlimitedSteps = { allowTerminalExecution: true, allowFileModifications: true, capabilityPolicyMode: 'network-approved', maxToolCallSteps: 0 }
  const roomySteps = { ...unlimitedSteps, maxToolCallSteps: 30 }
  const finishCall = { type: 'tool', name: 'finish', arguments: { summary: 'Done.' } }
  const advisesOf = (scenario, guard) => scenario.guardEvents.filter((event) => event.guard === guard && event.action === 'advise').length

  console.log('[guard 5/9] reads of the same file in slices')
  const readSlice = (startLine) => ({ type: 'tool', name: 'read_file', arguments: { filePath: 'guard-fixtures/note-1.txt', startLine, endLine: startLine } })
  const reads = await runGuardScenario('same-target-reads', [readSlice(1), readSlice(2), readSlice(3), readSlice(4), readSlice(5)], {
    capabilityProfile: roomySteps,
  })
  assert(advisesOf(reads, 'loop_same_target_reads') >= 1, describe(reads))
  assert.equal(reads.done.success, false)

  console.log('[guard 6/9] structured tools passed to run_command')
  const shellTool = (file) => ({ type: 'tool', name: 'run_command', arguments: { command: `read_file guard-fixtures/${file}` } })
  const confusion = await runGuardScenario('shell-tool-confusion', [shellTool('note-2.txt'), shellTool('note-3.txt'), shellTool('note-4.txt')], {
    capabilityProfile: roomySteps,
  })
  // Each call is refused on its own (TOOL_AS_SHELL_BLOCK) and counts toward execution_budget; the
  // separate loop pattern for it never fired live and was removed on 2026-09-26.
  assert.equal(advisesOf(confusion, 'execution_budget'), 3, describe(confusion))
  assert(confusion.logs.filter((message) => String(message).includes('TOOL_AS_SHELL_BLOCK')).length >= 3, describe(confusion))
  assert.equal(confusion.done.success, false)

  console.log('[guard 7/9] a file written back to earlier contents')
  // Two files alternate so neither the same-file edit count nor the exact-repeat check blocks a write first.
  const oscillation = await runGuardScenario(
    'fs-oscillation',
    [
      writeCall('guard-fixtures/toggle.txt', 'A\n'),
      writeCall('guard-fixtures/side.txt', 'x1\n'),
      writeCall('guard-fixtures/toggle.txt', 'B\n'),
      writeCall('guard-fixtures/side.txt', 'x2\n'),
      writeCall('guard-fixtures/toggle.txt', 'A\n'),
      writeCall('guard-fixtures/side.txt', 'x3\n'),
      writeCall('guard-fixtures/toggle.txt', 'B\n'),
      writeCall('guard-fixtures/side.txt', 'x4\n'),
      writeCall('guard-fixtures/toggle.txt', 'A\n'),
      finishCall,
    ],
    { capabilityProfile: roomySteps },
  )
  assert(advisesOf(oscillation, 'fs_oscillation') >= 1, describe(oscillation))

  console.log('[guard 8/9] a loop with no step budget')
  const stuckWrite = writeCall('guard-fixtures/stuck.txt', 'stuck\n')
  const stagnation = await runGuardScenario(
    'stagnation-abort',
    Array.from({ length: 40 }, () => stuckWrite),
    { capabilityProfile: unlimitedSteps },
  )
  assert.equal(stagnation.done.success, false)
  assert.deepEqual(stagnation.stop, ['stagnation_abort'], describe(stagnation))
  assert.equal(stagnation.done.completionStatus, 'blocked')

  console.log('[guard 9/9] a project check that keeps failing at finish')
  // Last on purpose: the failing test script stays in the shared scratch workspace.
  fs.writeFileSync(
    path.join(scratchPath, 'package.json'),
    JSON.stringify({ name: 'guard-fixture', private: true, scripts: { test: 'node -e "process.exit(1)"' } }),
    'utf8',
  )
  const fixCycles = await runGuardScenario(
    'verification-fix-cycles',
    [writeCall('guard-fixtures/fix.txt', 'first\n'), finishCall, writeCall('guard-fixtures/fix.txt', 'second\n'), finishCall, finishCall, finishCall],
    { capabilityProfile: roomySteps },
  )
  assert(advisesOf(fixCycles, 'verification_fix_cycles') >= 1, describe(fixCycles))
  assert.equal(fixCycles.done.success, false)
  assert.equal(fixCycles.done.completionStatus, 'blocked')

  console.log('[PASS] 8 Electron Agent Coding reliability scenarios and 9 guard scenarios passed.')
} finally {
  releasePendingResponses()
  if (application) await application.close().catch(() => {})
  await new Promise((resolve) => ollamaServer.close(resolve))
  await new Promise((resolve) => setTimeout(resolve, 500))
  assertSafeTempRoot()
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
}
