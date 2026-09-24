import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { analyzeLogs } from './logDiagnosticsAppService'

describe('logDiagnosticsAppService', () => {
  let logDir: string

  beforeAll(() => {
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-log-diagnostics-'))
    fs.writeFileSync(path.join(logDir, 'session.log'), ['[INFO] started', '[ERROR] CUDA out of memory', '[INFO] done'].join('\n'), 'utf8')
    fs.writeFileSync(path.join(logDir, 'ignored.bin'), 'CUDA out of memory', 'utf8')
  })

  afterAll(() => {
    fs.rmSync(logDir, { recursive: true, force: true })
  })

  it('scans .log files in the extra directories and reports their anomalies', () => {
    const report = analyzeLogs([logDir])

    const sessionLog = path.join(logDir, 'session.log')
    expect(report.scanned_files).toContain(sessionLog)
    expect(report.scanned_files).not.toContain(path.join(logDir, 'ignored.bin'))
    expect(report.anomalies.filter((anomaly) => anomaly.log_file === sessionLog)).toEqual([
      expect.objectContaining({ anomaly_type: 'VRAM_THRASH:CUDA_OOM', severity: 'CRITICAL', line_number: 2 }),
    ])
    expect(report.has_critical).toBe(true)
  })
})
