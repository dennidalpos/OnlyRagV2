import { randomUUID } from 'node:crypto'
import type { OllamaGenerationOperation, OllamaGenerationOperationState, OllamaGenerationStatus } from '../../../../shared/types'

export class OllamaGenerationCancelledError extends Error {
  constructor(message: string = 'Ollama generation cancelled before execution.') {
    super(message)
    this.name = 'OllamaGenerationCancelledError'
  }
}

interface GenerationJob<T> {
  id: string
  label: string
  run: (setActiveCancel: (cancel: () => void) => void) => Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
  activeCancel?: () => void
  cancelled: boolean
  state: OllamaGenerationOperationState
}

export interface ScheduledGeneration<T> {
  id: string
  promise: Promise<T>
  cancel: () => void
}

/** Serializes every Main-process Ollama generation without pre-empting the active request. */
export class OllamaGenerationScheduler {
  private queue: GenerationJob<unknown>[] = []
  private active: GenerationJob<unknown> | null = null
  private terminalOperations: OllamaGenerationOperation[] = []

  schedule<T>(
    label: string,
    run: (setActiveCancel: (cancel: () => void) => void) => Promise<T>,
    id: string = randomUUID()
  ): ScheduledGeneration<T> {
    let job!: GenerationJob<T>
    const promise = new Promise<T>((resolve, reject) => {
      job = { id, label, run, resolve, reject, cancelled: false, state: 'queued' }
    })

    const cancel = () => {
      if (job.cancelled) return
      job.cancelled = true
      job.state = 'cancelling'
      if (this.active === job) {
        job.activeCancel?.()
        return
      }
      const index = this.queue.indexOf(job as GenerationJob<unknown>)
      if (index >= 0) this.queue.splice(index, 1)
      this.rememberTerminal(job)
      job.reject(new OllamaGenerationCancelledError())
    }

    this.queue.push(job as GenerationJob<unknown>)
    void this.drain()
    return { id, promise, cancel }
  }

  cancel(id: string): boolean {
    const job = this.active?.id === id ? this.active : this.queue.find((item) => item.id === id)
    if (!job || job.cancelled) return false
    job.cancelled = true
    job.state = 'cancelling'
    if (this.active === job) {
      job.activeCancel?.()
    } else {
      this.queue = this.queue.filter((item) => item !== job)
      this.rememberTerminal(job)
      job.reject(new OllamaGenerationCancelledError())
    }
    return true
  }

  getStatus(): OllamaGenerationStatus {
    return {
      active: this.active ? { id: this.active.id, label: this.active.label } : null,
      queued: this.queue.map((job) => ({ id: job.id, label: job.label })),
      operations: [
        ...(this.active ? [this.toOperation(this.active)] : []),
        ...this.queue.map((job) => this.toOperation(job)),
        ...this.terminalOperations,
      ],
    }
  }

  private async drain(): Promise<void> {
    if (this.active) return
    const next = this.queue.shift()
    if (!next) return
    if (next.cancelled) {
      void this.drain()
      return
    }

    this.active = next
    next.state = 'running'
    let completed = false
    try {
      const value = await next.run((cancel) => { next.activeCancel = cancel })
      if (!next.cancelled) {
        completed = true
        next.resolve(value)
      }
      else next.reject(new OllamaGenerationCancelledError('Active Ollama generation cancelled.'))
    } catch (error) {
      next.reject(next.cancelled ? new OllamaGenerationCancelledError('Active Ollama generation cancelled.') : error)
    } finally {
      if (next.cancelled) this.rememberTerminal(next)
      else if (!completed) {
        next.state = 'failed'
        this.rememberTerminal(next)
      }
      this.active = null
      void this.drain()
    }
  }

  private toOperation<T>(job: GenerationJob<T>): OllamaGenerationOperation {
    return { id: job.id, label: job.label, state: job.state }
  }

  private rememberTerminal<T>(job: GenerationJob<T>): void {
    this.terminalOperations = [
      this.toOperation(job),
      ...this.terminalOperations.filter((item) => item.id !== job.id),
    ].slice(0, 12)
  }
}

export const ollamaGenerationScheduler = new OllamaGenerationScheduler()
