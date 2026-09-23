import { BrowserWindow } from 'electron'
import type { RendererEventSink } from '../../domain/ports/rendererEventSink'

/** Sends to the window returned by `getWindow` at delivery time, skipping it once destroyed. */
export function createWindowEventSink(getWindow: () => BrowserWindow | null): RendererEventSink {
  const liveWindow = () => {
    const win = getWindow()
    return win && !win.isDestroyed() ? win : null
  }
  return {
    isAvailable: () => liveWindow() !== null,
    send: (channel, payload) => liveWindow()?.webContents.send(channel, payload),
  }
}

/** Open windows; empty when the Electron runtime is absent (unit tests import Main modules under plain Node). */
const openWindows = (): BrowserWindow[] =>
  typeof BrowserWindow?.getAllWindows === 'function' ? BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed()) : []

/** Broadcasts to every open application window (document ingestion and workspace notifications). */
export const allWindowsEventSink: RendererEventSink = {
  isAvailable: () => openWindows().length > 0,
  send: (channel, payload) => {
    for (const win of openWindows()) win.webContents.send(channel, payload)
  },
}
