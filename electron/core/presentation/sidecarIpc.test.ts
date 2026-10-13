import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', async (importOriginal) => ({
  ...(await importOriginal<typeof import('electron')>()),
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
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

vi.mock('../application/sessionHistoryAppService', () => ({
  sessionHistoryAppService: { indexPromptHistory: vi.fn().mockResolvedValue({ success: true }) },
}))

import { sidecarAppService } from '../application/sidecarAppService'
import { sessionHistoryAppService } from '../application/sessionHistoryAppService'
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

  it('forwards validated prompt history to the session lifecycle service', async () => {
    const payload = {
      id: 'history-1',
      sessionId: 'session-1',
      workspacePath: 'D:/fixture',
      prompt: 'Fixture prompt',
      outcome: 'success',
      startedAt: '2026-10-13T10:00:00Z',
    }
    await expect(handlers.get('history:index')?.(trustedEvent, payload)).resolves.toEqual({ success: true })
    expect(sessionHistoryAppService.indexPromptHistory).toHaveBeenCalledWith(payload)
  })

  it('validates ingest payloads before forwarding normalized values', async () => {
    const handler = handlers.get('ingest:file')
    await handler?.(trustedEvent, {
      filePath: 'D:/docs/report.pdf',
      visionModel: 'vision-model',
      visionPrompt: 'Describe the page',
      normalizeWithLlm: true,
      normalizationModel: 'normalizer',
      numCtx: 8192,
      taskId: 'ingest-test-1',
      allowFullExcelFormat: true,
    })

    expect(sidecarAppService.ingestFile).toHaveBeenCalledWith(
      'D:/docs/report.pdf',
      'vision-model',
      'Describe the page',
      true,
      'normalizer',
      8192,
      'ingest-test-1',
      undefined,
      true,
    )
    expect(() => handler?.(trustedEvent, { filePath: ' ' })).toThrow('Invalid IPC payload for ingest:file')
    expect(sidecarAppService.ingestFile).toHaveBeenCalledTimes(1)
  })
})
