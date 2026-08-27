import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: any[]) => any>()

vi.mock('electron', async (importOriginal) => ({
  ...await importOriginal<typeof import('electron')>(),
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler)
    }),
  },
}))

vi.mock('../application/sidecarAppService', () => ({
  sidecarAppService: {
    getStatus: vi.fn().mockResolvedValue({ status: 'online' }),
    restartSidecar: vi.fn().mockResolvedValue({ success: true }),
    ingestFile: vi.fn().mockResolvedValue({ success: true }),
  },
}))

import { sidecarAppService } from '../application/sidecarAppService'
import { registerSidecarIpcHandlers } from './sidecarIpc'

describe('sidecar IPC facade', () => {
  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
    registerSidecarIpcHandlers()
  })

  it('forwards status and restart requests to the application service', async () => {
    await expect(handlers.get('sidecar:status')?.({})).resolves.toEqual({ status: 'online' })
    await expect(handlers.get('sidecar:restart')?.({})).resolves.toEqual({ success: true })

    expect(sidecarAppService.getStatus).toHaveBeenCalledOnce()
    expect(sidecarAppService.restartSidecar).toHaveBeenCalledOnce()
  })

  it('validates ingest payloads before forwarding normalized values', async () => {
    const handler = handlers.get('ingest:file')
    await handler?.({}, 'D:/docs/report.pdf', 'vision-model', 'Describe the page', true, 'normalizer', 8192)

    expect(sidecarAppService.ingestFile).toHaveBeenCalledWith(
      'D:/docs/report.pdf',
      'vision-model',
      'Describe the page',
      true,
      'normalizer',
      8192
    )
    await expect(handler?.({}, ' ')).rejects.toThrow()
    expect(sidecarAppService.ingestFile).toHaveBeenCalledTimes(1)
  })
})
