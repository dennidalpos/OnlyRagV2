import fs from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { logger } from '../logging/logger'
import { isTypecheckedSource, type TypecheckRequest, type TypecheckResponse, WorkspaceIncrementalTypecheck } from './workspaceIncrementalTypecheck'

// Generous for a cold ts.createProgram on a large workspace; past it the diagnostic is dropped.
const DEFAULT_TIMEOUT_MS = 60_000

interface PendingCheck {
  resolve: (diagnostic: string | null) => void
  timer: NodeJS.Timeout
}

/**
 * Runs WorkspaceIncrementalTypecheck on a worker thread, so a ts.createProgram after an agent
 * edit no longer blocks the Electron main thread. The worker keeps the per-workspace Program
 * cache between calls and handles one request at a time. The result is advisory: a timeout or a
 * worker failure yields no diagnostic, and the next call starts a fresh worker. When the bundled
 * worker script is absent (Vitest runs the sources) the check runs in-process.
 */
export class WorkspaceTypecheckWorkerClient {
  private worker: Worker | null = null
  private nextId = 0
  private readonly pending = new Map<number, PendingCheck>()
  private inProcessChecker: WorkspaceIncrementalTypecheck | null = null

  constructor(
    private readonly workerScriptPath: string,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  checkWrittenFile(workspacePath: string, absoluteFilePath: string): Promise<string | null> {
    if (!isTypecheckedSource(absoluteFilePath)) return Promise.resolve(null)
    if (!fs.existsSync(this.workerScriptPath)) {
      this.inProcessChecker ??= new WorkspaceIncrementalTypecheck()
      return Promise.resolve(this.inProcessChecker.checkWrittenFile(workspacePath, absoluteFilePath))
    }

    const worker = this.ensureWorker()
    const id = ++this.nextId
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        logger.log('WARN', 'TypecheckWorker', `Typecheck of ${absoluteFilePath} exceeded ${this.timeoutMs} ms; restarting the worker.`)
        this.resetWorker()
      }, this.timeoutMs)
      this.pending.set(id, { resolve, timer })
      const request: TypecheckRequest = { id, workspacePath, filePath: absoluteFilePath }
      worker.postMessage(request)
    })
  }

  dispose(): void {
    this.resetWorker()
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(this.workerScriptPath)
    worker.unref()
    worker.on('message', (response: TypecheckResponse) => this.settle(response.id, response.diagnostic))
    worker.on('error', (error) => {
      logger.log('WARN', 'TypecheckWorker', `Typecheck worker failed: ${error instanceof Error ? error.message : String(error)}`)
      if (this.worker === worker) this.resetWorker()
    })
    worker.on('exit', () => {
      if (this.worker === worker) this.resetWorker()
    })
    this.worker = worker
    return worker
  }

  private settle(id: number, diagnostic: string | null): void {
    const entry = this.pending.get(id)
    if (!entry) return
    clearTimeout(entry.timer)
    this.pending.delete(id)
    entry.resolve(diagnostic)
  }

  private resetWorker(): void {
    const worker = this.worker
    this.worker = null
    for (const id of [...this.pending.keys()]) this.settle(id, null)
    if (worker) void worker.terminate()
  }
}

// Main is bundled as dist-electron/main.js next to the worker entry (electron/typecheckWorker.ts).
export const workspaceTypecheckWorker = new WorkspaceTypecheckWorkerClient(path.join(__dirname, 'typecheckWorker.js'))
