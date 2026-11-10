import type { IpcEventChannel, IpcEventContract } from '../../../../shared/ipc/ipcContract'

/** Main → Renderer event delivery without an Electron dependency; adapters live in infrastructure/electron. */
export interface RendererEventSink {
  /** False once the target renderer is gone; callers skip work that only feeds the UI. */
  isAvailable(): boolean
  /** Delivers the event, or drops it silently when no renderer is available. */
  send<C extends IpcEventChannel>(channel: C, payload: IpcEventContract[C]): void
}
