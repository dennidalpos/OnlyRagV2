import { beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '../infrastructure/logging/logger'
import { DiagnosticsAppService } from './diagnosticsAppService'

describe('DiagnosticsAppService', () => {
  const service = new DiagnosticsAppService()

  beforeEach(() => {
    logger.clearLogs()
  })

  it('delegates log access and telemetry without changing the IPC-facing contract', () => {
    service.logTelemetry('INFO', 'DiagnosticsTest', 'telemetry message')

    expect(service.getLogs().at(-1)).toMatchObject({
      level: 'INFO',
      category: 'DiagnosticsTest',
      message: 'telemetry message',
    })

    service.clearLogs()

    expect(service.getLogs()).toEqual([])
    expect(service.getLogFilePath()).toEqual(logger.getLogFilePath())
  })
})

describe('DiagnosticsAppService.runDiagnostics', () => {
  it('reports the Sidecar health it just checked through the hardware probe port', async () => {
    const sidecar = { status: 'online' as const, version: '2.5.0' }
    const report = { timestamp: 'now' }
    const runFullDiagnostics = vi.fn(async () => report as never)
    const service = new DiagnosticsAppService({ openPath: vi.fn() }, { runFullDiagnostics }, async () => sidecar)

    await expect(service.runDiagnostics('http://127.0.0.1:11434')).resolves.toBe(report)
    expect(runFullDiagnostics).toHaveBeenCalledWith(sidecar, 'http://127.0.0.1:11434')
  })
})
