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
import { setTrustedIpcWindowProvider } from './secureIpcMain'

const trustedContents = { mainFrame: {} }
const trustedEvent = { sender: trustedContents, senderFrame: trustedContents.mainFrame }

describe('sidecar IPC facade', () => {
  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
    setTrustedIpcWindowProvider(() => ({ webContents: trustedContents }) as never)
    registerSidecarIpcHandlers()
  })

  it('forwards restart requests to the application service', async () => {
    await expect(handlers.get('sidecar:restart')?.(trustedEvent)).resolves.toEqual({ success: true })

    expect(sidecarAppService.restartSidecar).toHaveBeenCalledOnce()
  })

  it('validates ingest payloads before forwarding normalized values', async () => {
    const handler = handlers.get('ingest:file')
    await handler?.(trustedEvent, 'D:/docs/report.pdf', 'vision-model', 'Describe the page', true, 'normalizer', 8192, 'ingest-test-1')

    expect(sidecarAppService.ingestFile).toHaveBeenCalledWith(
      'D:/docs/report.pdf',
      'vision-model',
      'Describe the page',
      true,
      'normalizer',
      8192,
      'ingest-test-1',
      undefined
    )
    expect(() => handler?.(trustedEvent, ' ')).toThrow('Invalid IPC payload for ingest:file')
    expect(sidecarAppService.ingestFile).toHaveBeenCalledTimes(1)
  })
})
