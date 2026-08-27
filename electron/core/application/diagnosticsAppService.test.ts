import { beforeEach, describe, expect, it } from 'vitest'
import { logger } from '../../diagnostics'
import { httpMetrics } from '../infrastructure/http/httpMetrics'
import { DiagnosticsAppService } from './diagnosticsAppService'

describe('DiagnosticsAppService', () => {
  const service = new DiagnosticsAppService()

  beforeEach(() => {
    httpMetrics.reset()
    logger.clearLogs()
  })

  it('returns an isolated HTTP metrics snapshot', () => {
    httpMetrics.record('/health', 200, 'none', 12)

    const firstSnapshot = service.getHttpMetrics()
    firstSnapshot[0].count = 99
    firstSnapshot.push({
      endpoint: '/injected',
      status: 200,
      errorType: 'none',
      count: 1,
      totalDurationMs: 1,
      maxDurationMs: 1,
    })

    expect(service.getHttpMetrics()).toEqual([
      {
        endpoint: '/health',
        status: 200,
        errorType: 'none',
        count: 1,
        totalDurationMs: 12,
        maxDurationMs: 12,
      },
    ])
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
