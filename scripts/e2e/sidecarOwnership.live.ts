import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const context = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => context.userData, isPackaged: false } }))

import { SidecarProcessManager } from '../../electron/core/infrastructure/process/sidecarProcessManager'
import type { SidecarOwnershipMarker } from '../../electron/core/infrastructure/process/orphanPortReclaim'

const root = process.platform === 'win32' ? fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-sidecar-ownership-')) : ''
context.userData = root
const children: ChildProcess[] = []
const manager = new SidecarProcessManager()
/** The private ownership checks this scenario drives directly against real processes. */
const ownership = manager as unknown as {
  readProcessIdentity(pid: number | undefined): Promise<SidecarOwnershipMarker | null>
  reclaimOrphanSidecarPort(): Promise<boolean>
}
const markerPath = path.join(root, 'sidecar-ownership.json')

async function waitForPort(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:8000/health', { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return
    } catch {
      /* The owned child is still starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Owned test process did not open port 8000')
}

function stopOwnedProcess(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null) return
  try {
    execFileSync('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' })
  } catch {
    /* The test may already have reclaimed this child. */
  }
}

describe.skipIf(process.platform !== 'win32')('Windows Sidecar ownership integration', () => {
  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      const probe = net.createServer()
      probe.once('error', reject)
      probe.listen(8000, '127.0.0.1', () => probe.close(() => resolve()))
    })
  })

  afterAll(() => {
    for (const child of children) stopOwnedProcess(child)
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  })

  it('keeps an unknown listener and a reused PID safe, then reclaims the exact owned process', async () => {
    const serverScript = [
      "const http = require('node:http')",
      "http.createServer((_, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ status: 'online', engine: 'test', version: '1', vector_db: 'test', gpu: {}, ocr: {}, documents_count: 0, chunks_count: 0, python_version: 'test' })) }).listen(8000, '127.0.0.1')",
    ].join('; ')
    const child = spawn(process.execPath, ['-e', serverScript], { windowsHide: true, stdio: 'ignore' })
    children.push(child)
    await waitForPort(10_000)
    const identity = await ownership.readProcessIdentity(child.pid)
    expect(identity?.pid).toBe(child.pid)

    expect(await ownership.reclaimOrphanSidecarPort()).toBe(false)
    expect(child.exitCode).toBeNull()
    fs.writeFileSync(markerPath, JSON.stringify({ ...identity, startedAt: '2000-01-01T00:00:00.000Z' }))
    expect(await ownership.reclaimOrphanSidecarPort()).toBe(false)
    expect(child.exitCode).toBeNull()

    fs.writeFileSync(markerPath, JSON.stringify(identity))
    expect(await ownership.reclaimOrphanSidecarPort()).toBe(true)
  })

  it('reclaims a packaged sidecar.exe only with its exact process identity', async () => {
    const exe = path.resolve('sidecar_dist/sidecar/sidecar.exe')
    expect(fs.existsSync(exe)).toBe(true)
    const child = spawn(exe, [], {
      cwd: path.dirname(exe),
      env: { ...process.env, ONLYRAG_DATA_DIR: root },
      windowsHide: true,
      stdio: 'ignore',
    })
    children.push(child)
    await waitForPort(60_000)
    const identity = await ownership.readProcessIdentity(child.pid)
    expect(identity?.pid).toBe(child.pid)
    expect(identity?.executablePath.toLowerCase()).toBe(exe.toLowerCase())
    fs.writeFileSync(markerPath, JSON.stringify(identity))
    expect(await ownership.reclaimOrphanSidecarPort()).toBe(true)
  })
})
