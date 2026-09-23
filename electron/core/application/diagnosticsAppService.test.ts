import { beforeEach, describe, expect, it } from 'vitest'
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
