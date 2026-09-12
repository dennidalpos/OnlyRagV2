import { randomUUID } from 'node:crypto'

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

  schedule<T>(
    label: string,
    run: (setActiveCancel: (cancel: () => void) => void) => Promise<T>,
    id: string = randomUUID()
  ): ScheduledGeneration<T> {
    let job!: GenerationJob<T>
    const promise = new Promise<T>((resolve, reject) => {
      job = { id, label, run, resolve, reject, cancelled: false }
    })

    const cancel = () => {
      if (job.cancelled) return
      job.cancelled = true
      if (this.active === job) {
        job.activeCancel?.()
        return
      }
      const index = this.queue.indexOf(job as GenerationJob<unknown>)
      if (index >= 0) this.queue.splice(index, 1)
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
    if (this.active === job) {
      job.activeCancel?.()
    } else {
      this.queue = this.queue.filter((item) => item !== job)
      job.reject(new OllamaGenerationCancelledError())
    }
    return true
  }

  getStatus(): { active: { id: string; label: string } | null; queued: { id: string; label: string }[] } {
    return {
      active: this.active ? { id: this.active.id, label: this.active.label } : null,
      queued: this.queue.map((job) => ({ id: job.id, label: job.label })),
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
    try {
      const value = await next.run((cancel) => { next.activeCancel = cancel })
      if (!next.cancelled) next.resolve(value)
      else next.reject(new OllamaGenerationCancelledError('Active Ollama generation cancelled.'))
    } catch (error) {
      next.reject(next.cancelled ? new OllamaGenerationCancelledError('Active Ollama generation cancelled.') : error)
    } finally {
      this.active = null
      void this.drain()
    }
  }
}

export const ollamaGenerationScheduler = new OllamaGenerationScheduler()
