import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkspaceTypecheckWorkerClient } from './workspaceTypecheckWorkerClient'

const ECHO_WORKER = `
const { parentPort } = require('node:worker_threads')
let calls = 0
parentPort.on('message', (request) => {
  calls += 1
  if (request.filePath.endsWith('hang.ts')) return
  if (request.filePath.endsWith('crash.ts')) throw new Error('checker crashed')
  parentPort.postMessage({ id: request.id, diagnostic: 'call ' + calls + ': ' + request.filePath })
})
`

describe('WorkspaceTypecheckWorkerClient', () => {
  let tempDir: string
  let workerScript: string
  const clients: WorkspaceTypecheckWorkerClient[] = []

  const createClient = (scriptPath: string, timeoutMs?: number) => {
    const client = new WorkspaceTypecheckWorkerClient(scriptPath, timeoutMs)
    clients.push(client)
    return client
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-typecheck-worker-'))
    workerScript = path.join(tempDir, 'typecheckWorker.cjs')
    fs.writeFileSync(workerScript, ECHO_WORKER, 'utf-8')
  })

  afterEach(() => {
    for (const client of clients.splice(0)) client.dispose()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('answers from the worker and keeps one worker across calls', async () => {
    const client = createClient(workerScript)

    await expect(client.checkWrittenFile(tempDir, path.join(tempDir, 'a.ts'))).resolves.toBe(`call 1: ${path.join(tempDir, 'a.ts')}`)
    await expect(client.checkWrittenFile(tempDir, path.join(tempDir, 'b.tsx'))).resolves.toBe(`call 2: ${path.join(tempDir, 'b.tsx')}`)
  })

  it('skips files that are not typechecked without posting to the worker', async () => {
    const client = createClient(workerScript)

    await expect(client.checkWrittenFile(tempDir, path.join(tempDir, 'notes.md'))).resolves.toBeNull()
    await expect(client.checkWrittenFile(tempDir, path.join(tempDir, 'a.ts'))).resolves.toBe(`call 1: ${path.join(tempDir, 'a.ts')}`)
  })

  it('drops a check that exceeds the timeout and starts a fresh worker for the next one', async () => {
    const client = createClient(workerScript, 200)

    await expect(client.checkWrittenFile(tempDir, path.join(tempDir, 'hang.ts'))).resolves.toBeNull()
    await expect(client.checkWrittenFile(tempDir, path.join(tempDir, 'a.ts'))).resolves.toBe(`call 1: ${path.join(tempDir, 'a.ts')}`)
  })

  it('resolves with no diagnostic when the worker crashes, then recovers', async () => {
    const client = createClient(workerScript)

    await expect(client.checkWrittenFile(tempDir, path.join(tempDir, 'crash.ts'))).resolves.toBeNull()
    await expect(client.checkWrittenFile(tempDir, path.join(tempDir, 'a.ts'))).resolves.toBe(`call 1: ${path.join(tempDir, 'a.ts')}`)
  })

  it('runs the real checker in-process when the worker script is absent', async () => {
    fs.mkdirSync(path.join(tempDir, 'src'))
    fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ['src'] }), 'utf-8')
    const filePath = path.join(tempDir, 'src', 'value.ts')
    fs.writeFileSync(filePath, 'const value: number = "wrong"\nexport { value }\n', 'utf-8')
    const client = createClient(path.join(tempDir, 'missing-worker.js'))

    const diagnostic = await client.checkWrittenFile(tempDir, filePath)

    expect(diagnostic).toContain('[POST-WRITE TYPECHECK DIAGNOSTIC]')
    expect(diagnostic).toContain('src/value.ts(1,7): error TS2322')
  })
})
