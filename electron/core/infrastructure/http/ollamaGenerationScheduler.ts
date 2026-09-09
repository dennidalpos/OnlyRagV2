export class OllamaGenerationCancelledError extends Error {
  constructor(message: string = 'Ollama generation cancelled before execution.') {
    super(message)
    this.name = 'OllamaGenerationCancelledError'
  }
}

interface GenerationJob<T> {
  label: string
  run: (setActiveCancel: (cancel: () => void) => void) => Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
  activeCancel?: () => void
  cancelled: boolean
}

export interface ScheduledGeneration<T> {
  promise: Promise<T>
  cancel: () => void
}

/** Serializes every Main-process Ollama generation without pre-empting the active request. */
export class OllamaGenerationScheduler {
  private queue: GenerationJob<unknown>[] = []
  private active: GenerationJob<unknown> | null = null

  schedule<T>(
    label: string,
    run: (setActiveCancel: (cancel: () => void) => void) => Promise<T>
  ): ScheduledGeneration<T> {
    let job!: GenerationJob<T>
    const promise = new Promise<T>((resolve, reject) => {
      job = { label, run, resolve, reject, cancelled: false }
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
    return { promise, cancel }
  }

  getStatus(): { activeLabel: string | null; queuedLabels: string[] } {
    return {
      activeLabel: this.active?.label || null,
      queuedLabels: this.queue.map((job) => job.label),
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
