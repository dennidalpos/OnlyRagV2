import { describe, expect, it } from 'vitest'
import { buildLogDiagnosticReport, scanLogLines } from './logAnomalyScanner'

const toolCall = (tool: string) => `{"tool_name": "${tool}", "arguments": {"filePath": "app.ts"}}`

describe('logAnomalyScanner', () => {
  it('detects truncated JSON, GPU and connection failures with remediation', () => {
    const anomalies = scanLogLines('session.log', [
      '[INFO] Application started successfully',
      '[ERROR] CUDA out of memory. Tried to allocate 4.00 GiB on device 0',
      '{"malformed_tool_json": {"nested": "value_without_closing_brace_which_is_too_long_and_truncated_by_model_context_limit_exceeded_xyz_1234567890',
      '[WARN] Ollama connect refused 11434',
    ])

    expect(anomalies.map((anomaly) => [anomaly.anomaly_type, anomaly.severity, anomaly.line_number])).toEqual([
      ['TRUNCATED_JSON', 'ERROR', 3],
      ['VRAM_THRASH:CUDA_OOM', 'CRITICAL', 2],
      ['VRAM_THRASH:OLLAMA_TIMEOUT', 'ERROR', 4],
    ])
    for (const anomaly of anomalies) expect(anomaly.remediation?.length).toBeGreaterThan(5)
  })

  it('reports one tool loop once, not once per overlapping window', () => {
    const lines = Array.from({ length: 10 }, () => toolCall('read_file'))

    const loops = scanLogLines('session.log', lines).filter((anomaly) => anomaly.anomaly_type === 'TOOL_LOOP')

    expect(loops).toHaveLength(1)
    expect(loops[0]).toMatchObject({ severity: 'CRITICAL', line_number: 1, count: 10 })
  })

  it('reports a loop again once it recurs beyond the reported window', () => {
    const lines = [
      ...Array.from({ length: 3 }, () => toolCall('list_dir')),
      ...Array.from({ length: 40 }, () => '[INFO] step'),
      ...Array.from({ length: 3 }, () => toolCall('list_dir')),
    ]

    const loops = scanLogLines('session.log', lines).filter((anomaly) => anomaly.anomaly_type === 'TOOL_LOOP')

    expect(loops.map((anomaly) => anomaly.line_number)).toEqual([1, 31])
  })

  it('does not flag a tool named fewer times than the threshold', () => {
    expect(scanLogLines('session.log', [toolCall('read_file'), toolCall('read_file'), toolCall('write_file')])).toEqual([])
  })

  it('summarizes anomaly counts and criticality', () => {
    const anomalies = scanLogLines('session.log', ['CUDA out of memory', 'CUDA out of memory', 'HTTP 504 Gateway Timeout'])

    const report = buildLogDiagnosticReport(['session.log'], 3, anomalies)

    expect(report.has_critical).toBe(true)
    expect(report.summary).toBe('Anomalie rilevate — VRAM_THRASH:CUDA_OOM: 2, VRAM_THRASH:GATEWAY_TIMEOUT: 1')
    expect(buildLogDiagnosticReport([], 0, [])).toMatchObject({ has_critical: false, summary: 'Nessuna anomalia rilevata — log di sistema puliti.' })
  })
})
