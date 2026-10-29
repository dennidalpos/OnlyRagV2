import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { dependencyScanResponseSchema, type DependencyScanResult } from './dependencyScanProtocol'

interface ScanJob {
  root: string
  deadline: number
  signal?: AbortSignal
  onAbort: () => void
  timer: NodeJS.Timeout
  worker?: Worker
  completion?: Promise<void>
  resolve: (result: DependencyScanResult) => void
  reject: (error: unknown) => void
}

const MAX_QUEUED_SCANS = 32
const RESOURCE_LIMITS = { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 }

/** One owned parser worker at a time; unavailable work never falls back to Main. */
export class DependencyScanWorkerClient {
  private readonly queue: ScanJob[] = []
  private active: ScanJob | undefined
  private stopped = false
  private shutdownPromise: Promise<void> | undefined

  constructor(private readonly workerScriptPath: string) {}

  scan(root: string, timeoutMs = 60_000, signal?: AbortSignal): Promise<DependencyScanResult> {
    if (this.stopped || signal?.aborted) return Promise.reject(new Error('Dependency scan cancelled'))
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) return Promise.reject(new Error('Invalid dependency scan deadline'))
    if (this.queue.length >= MAX_QUEUED_SCANS) return Promise.reject(new Error('Dependency scan queue is full'))
    return new Promise((resolve, reject) => {
      const job: ScanJob = {
        root,
        deadline: Date.now() + timeoutMs,
        signal,
        onAbort: () => void this.finish(job, undefined, new Error('Dependency scan cancelled')),
        timer: setTimeout(() => void this.finish(job, undefined, new Error(`Dependency scan timed out after ${timeoutMs} ms`)), timeoutMs),
        resolve,
        reject,
      }
      signal?.addEventListener('abort', job.onAbort, { once: true })
      this.queue.push(job)
      this.startNext()
    })
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise
    this.stopped = true
    this.shutdownPromise = Promise.all(
      [...this.queue, ...(this.active ? [this.active] : [])].map((job) => this.finish(job, undefined, new Error('Dependency scanner shut down'))),
    ).then(() => undefined)
    return this.shutdownPromise
  }

  private startNext(): void {
    if (this.active || this.stopped) return
    const job = this.queue.shift()
    if (!job) return
    this.active = job
    if (job.signal?.aborted || Date.now() >= job.deadline) {
      void this.finish(job, undefined, new Error('Dependency scan cancelled or deadline expired'))
      return
    }
    try {
      const worker = new Worker(this.workerScriptPath, { workerData: { root: job.root }, resourceLimits: RESOURCE_LIMITS })
      job.worker = worker
      worker.once('message', (response: unknown) => {
        const parsed = dependencyScanResponseSchema.safeParse(response)
        if (!parsed.success) void this.finish(job, undefined, new Error('Invalid dependency scan response'))
        else void this.finish(job, parsed.data.result)
      })
      worker.once('error', (error) => void this.finish(job, undefined, error))
      worker.once('exit', (code) => void this.finish(job, undefined, new Error(`Dependency worker exited without a result (${code})`)))
      worker.once('messageerror', (error) => void this.finish(job, undefined, error))
    } catch (error: unknown) {
      void this.finish(job, undefined, error)
    }
  }

  private finish(job: ScanJob, result?: DependencyScanResult, error?: unknown): Promise<void> {
    if (job.completion) return job.completion
    job.completion = this.settle(job, result, error)
    return job.completion
  }

  private async settle(job: ScanJob, result?: DependencyScanResult, error?: unknown): Promise<void> {
    clearTimeout(job.timer)
    job.signal?.removeEventListener('abort', job.onAbort)
    const queuedIndex = this.queue.indexOf(job)
    if (queuedIndex >= 0) this.queue.splice(queuedIndex, 1)
    try {
      // Do not admit the next parser or acknowledge a result before the owned worker exits.
      if (job.worker) await job.worker.terminate()
      if (error) job.reject(error)
      else if (this.stopped || job.signal?.aborted || Date.now() >= job.deadline) job.reject(new Error('Dependency scan cancelled or deadline expired'))
      else if (result) job.resolve(result)
      else job.reject(new Error('Dependency scan produced no evidence'))
    } catch (terminationError: unknown) {
      this.stopped = true
      job.reject(terminationError)
      for (const queued of [...this.queue]) void this.finish(queued, undefined, new Error('Dependency worker termination failed'))
    } finally {
      if (this.active === job) this.active = undefined
      this.startNext()
    }
  }
}

export const dependencyScanWorker = new DependencyScanWorkerClient(path.join(__dirname, 'dependencyScanWorker.js'))
