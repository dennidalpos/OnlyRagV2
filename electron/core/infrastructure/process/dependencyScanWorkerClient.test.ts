import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DependencyScanWorkerClient } from './dependencyScanWorkerClient'

describe('owned dependency worker lifecycle', () => {
  let root: string
  let script: string
  let client: DependencyScanWorkerClient
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-scan-worker-'))
    script = path.join(root, 'fixture.cjs')
    // Declared transport fixture: synchronous work, process failure and response ownership.
    fs.writeFileSync(
      script,
      `
const { parentPort, workerData } = require('node:worker_threads')
const fs = require('node:fs')
fs.writeFileSync(workerData.root + '.started', '')
if (workerData.root.endsWith('loop')) { for (;;) {} }
if (workerData.root.endsWith('crash')) throw new Error('fixture crash')
if (workerData.root.endsWith('empty')) process.exit(0)
if (workerData.root.endsWith('bad')) parentPort.postMessage({ result: { scanned: true } })
else parentPort.postMessage({ result: { scanned: true, missing: {}, peerProviders: {} }, heapUsedBytes: process.memoryUsage().heapUsed })
parentPort.close()
`,
    )
    client = new DependencyScanWorkerClient(script)
  })
  afterEach(async () => {
    await client.shutdown()
    vi.restoreAllMocks()
    fs.rmSync(root, { recursive: true, force: true })
  })

  function request(name: string, deadline = 2000, signal?: AbortSignal) {
    return client.scan(path.join(root, name), deadline, signal)
  }

  it('accepts a valid result only after worker termination and clears the timer', async () => {
    const terminate = vi.spyOn(Worker.prototype, 'terminate')
    const clearTimer = vi.spyOn(globalThis, 'clearTimeout')
    expect((await request('ok')).scanned).toBe(true)
    expect(terminate).toHaveBeenCalledOnce()
    expect((terminate.mock.contexts[0] as Worker).threadId).toBe(-1)
    expect(clearTimer).toHaveBeenCalled()
  })

  it('keeps Main timers responsive while terminating synchronous parsing at the deadline', async () => {
    const terminate = vi.spyOn(Worker.prototype, 'terminate')
    let ticks = 0
    const timer = setInterval(() => ticks++, 10)
    try {
      await expect(request('loop', 250)).rejects.toThrow('timed out')
      expect(fs.existsSync(path.join(root, 'loop.started'))).toBe(true)
      expect(ticks).toBeGreaterThan(2)
      expect((terminate.mock.contexts[0] as Worker).threadId).toBe(-1)
      expect((await request('retry')).scanned).toBe(true)
    } finally {
      clearInterval(timer)
    }
  })

  it('cancels active parsing and refuses queued work without dispatch', async () => {
    const controller = new AbortController()
    const active = expect(request('loop', 2000, controller.signal)).rejects.toThrow('cancelled')
    await vi.waitFor(() => expect(fs.existsSync(path.join(root, 'loop.started'))).toBe(true))
    const queuedController = new AbortController()
    const queued = expect(request('queued', 2000, queuedController.signal)).rejects.toThrow('cancelled')
    queuedController.abort()
    await queued
    expect(fs.existsSync(path.join(root, 'queued.started'))).toBe(false)
    controller.abort()
    await active
    expect((await request('fresh')).scanned).toBe(true)
  })

  it('includes queue waiting in the deadline and admits no overlapping parser', async () => {
    const controller = new AbortController()
    const active = expect(request('loop', 2000, controller.signal)).rejects.toThrow('cancelled')
    await vi.waitFor(() => expect(fs.existsSync(path.join(root, 'loop.started'))).toBe(true))
    await expect(request('expired', 30)).rejects.toThrow('timed out')
    expect(fs.existsSync(path.join(root, 'expired.started'))).toBe(false)
    controller.abort()
    await active
    expect((await request('next')).scanned).toBe(true)
  })

  it.each(['crash', 'empty', 'bad'])('refuses %s worker evidence and permits a fresh retry', async (name) => {
    await expect(request(name)).rejects.toThrow()
    expect((await request('retry')).scanned).toBe(true)
  })

  it('refuses a missing worker entry without an in-process fallback', async () => {
    const absent = new DependencyScanWorkerClient(path.join(root, 'absent.cjs'))
    await expect(absent.scan(root)).rejects.toThrow()
    await absent.shutdown()
  })

  it('bounds pending admission and terminates active and queued work on shutdown', async () => {
    const terminate = vi.spyOn(Worker.prototype, 'terminate')
    const active = expect(request('loop')).rejects.toThrow('shut down')
    const pending = Array.from({ length: 32 }, (_, index) => expect(request(`queued-${index}`)).rejects.toThrow('shut down'))
    await expect(request('overflow')).rejects.toThrow('queue is full')
    await client.shutdown()
    await Promise.all([active, ...pending])
    expect((terminate.mock.contexts[0] as Worker).threadId).toBe(-1)
    await expect(request('after-shutdown')).rejects.toThrow('cancelled')
    for (let index = 0; index < 32; index++) expect(fs.existsSync(path.join(root, `queued-${index}.started`))).toBe(false)
  })

  it('refuses already cancelled and invalid deadline requests before dispatch', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(request('cancelled', 2000, controller.signal)).rejects.toThrow('cancelled')
    await expect(request('invalid', 0)).rejects.toThrow('deadline')
    expect(fs.readdirSync(root)).toEqual(['fixture.cjs'])
  })
})
