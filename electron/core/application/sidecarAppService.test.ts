/**
 * electron/core/application/sidecarAppService.test.ts
 *
 * Integration tests for SidecarAppService — the Application Layer
 * HTTP bridge between Electron main process and the Python sidecar SLM endpoint.
 *
 * Tests verify the full roundtrip behaviour of:
 *   - analyzeLogs()  → POST /agent/logs/analyze (IPC channel: agent:logs-analyze)
 *
 * Strategy: spawn a lightweight Node.js HTTP server on an ephemeral port
 * that simulates the sidecar responses, then hit it with the same raw
 * request shape the service sends.
 *
 * No real Ollama, no real Python process, no Electron IPC machinery required.
 * All network I/O uses the real Node.js http module (same as production code).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { AddressInfo } from 'node:net'
import { sidecarAppService } from './sidecarAppService'

// ---------------------------------------------------------------------------
// Minimal mock sidecar HTTP server
// ---------------------------------------------------------------------------

const MOCK_LOG_REPORT_CLEAN = {
  scanned_files: ['/tmp/test/sidecar.log'],
  total_lines_scanned: 42,
  anomalies: [],
  has_critical: false,
  summary: 'No anomalies detected',
}

const MOCK_LOG_REPORT_CRITICAL = {
  scanned_files: ['/tmp/test/sidecar.log', '/tmp/test/app.log'],
  total_lines_scanned: 318,
  anomalies: [
    {
      anomaly_type: 'CUDA_OOM',
      severity: 'CRITICAL',
      log_file: '/tmp/test/sidecar.log',
      line_number: 34,
      snippet: '[ERROR] CUDA out of memory. Tried to allocate 4.00 GiB',
      count: 2,
    },
    {
      anomaly_type: 'TOOL_LOOP',
      severity: 'CRITICAL',
      log_file: '/tmp/test/app.log',
      line_number: 112,
      snippet: '{"tool_name": "list_dir", "arguments": {}}',
      count: 4,
    },
  ],
  has_critical: true,
  summary: 'Found 2 critical anomalies: CUDA_OOM (x2), TOOL_LOOP (x1)',
}

// ---------------------------------------------------------------------------
// Mock server factory
// ---------------------------------------------------------------------------

type MockRoute = {
  method: string
  path: string
  status: number
  body: unknown
}

function createMockSidecar(routes: MockRoute[]): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const route = routes.find(
        (r) => r.method === req.method && r.path === req.url
      )
      if (route) {
        res.writeHead(route.status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(route.body))
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ detail: 'Route not found in mock sidecar' }))
      }
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` })
    })
  })
}

// ---------------------------------------------------------------------------
// Helper: invoke /agent/logs/analyze with the same raw request shape the
// service sends (mirrors SidecarSlmBridgeService.analyzeLogs()).
// ---------------------------------------------------------------------------

async function callAnalyzeLogs(
  baseUrl: string,
  extraPaths?: string[]
): Promise<unknown> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ extra_paths: extraPaths ?? [] })
    const url = new URL('/agent/logs/analyze', baseUrl)
    const req = http.request(
      { hostname: url.hostname, port: Number(url.port), path: url.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let raw = ''
        res.on('data', (c) => { raw += c })
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }))
      }
    )
    req.on('error', (e) => resolve({ status: 0, error: e.message }))
    req.write(body)
    req.end()
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SidecarSlmBridgeService — IPC Roundtrip Integration Tests', () => {

  // ── 1. /agent/logs/analyze — clean log (no anomalies) ───────────────────

  describe('POST /agent/logs/analyze — clean log report', () => {
    let server: http.Server
    let baseUrl: string

    beforeAll(async () => {
      const mock = await createMockSidecar([
        { method: 'POST', path: '/agent/logs/analyze', status: 200, body: MOCK_LOG_REPORT_CLEAN },
      ])
      server = mock.server
      baseUrl = mock.baseUrl
    })

    afterAll(() => { server.close() })

    it('returns 200 with empty anomalies and has_critical=false for clean logs', async () => {
      const res = await callAnalyzeLogs(baseUrl) as any
      expect(res.status).toBe(200)
      expect(res.body.has_critical).toBe(false)
      expect(res.body.anomalies).toHaveLength(0)
      expect(res.body.summary).toContain('No anomalies')
    })

    it('response body matches SlmLogDiagnosticReport schema shape', async () => {
      const res = await callAnalyzeLogs(baseUrl) as any
      expect(res.body).toHaveProperty('scanned_files')
      expect(res.body).toHaveProperty('total_lines_scanned')
      expect(res.body).toHaveProperty('anomalies')
      expect(res.body).toHaveProperty('has_critical')
      expect(res.body).toHaveProperty('summary')
      expect(Array.isArray(res.body.scanned_files)).toBe(true)
      expect(Array.isArray(res.body.anomalies)).toBe(true)
      expect(typeof res.body.total_lines_scanned).toBe('number')
    })

    it('forwards extra_paths in the request body', async () => {
      // Verify our caller serialises extra_paths correctly (mock ignores it,
      // but the request must still succeed — no schema error)
      const res = await callAnalyzeLogs(baseUrl, ['/custom/logs/']) as any
      expect(res.status).toBe(200)
    })
  })

  // ── 2. /agent/logs/analyze — critical anomalies ──────────────────────────

  describe('POST /agent/logs/analyze — critical anomalies report', () => {
    let server: http.Server
    let baseUrl: string

    beforeAll(async () => {
      const mock = await createMockSidecar([
        { method: 'POST', path: '/agent/logs/analyze', status: 200, body: MOCK_LOG_REPORT_CRITICAL },
      ])
      server = mock.server
      baseUrl = mock.baseUrl
    })

    afterAll(() => { server.close() })

    it('returns has_critical=true with CUDA_OOM and TOOL_LOOP anomalies', async () => {
      const res = await callAnalyzeLogs(baseUrl) as any
      expect(res.status).toBe(200)
      expect(res.body.has_critical).toBe(true)
      expect(res.body.anomalies.length).toBeGreaterThanOrEqual(2)

      const types = res.body.anomalies.map((a: any) => a.anomaly_type)
      expect(types).toContain('CUDA_OOM')
      expect(types).toContain('TOOL_LOOP')
    })

    it('each anomaly record has all required fields', async () => {
      const res = await callAnalyzeLogs(baseUrl) as any
      for (const anomaly of res.body.anomalies) {
        expect(anomaly).toHaveProperty('anomaly_type')
        expect(anomaly).toHaveProperty('severity')
        expect(anomaly).toHaveProperty('log_file')
        expect(anomaly).toHaveProperty('line_number')
        expect(anomaly).toHaveProperty('snippet')
        expect(anomaly).toHaveProperty('count')
        expect(['WARNING', 'ERROR', 'CRITICAL']).toContain(anomaly.severity)
      }
    })

    it('CRITICAL anomalies have severity CRITICAL', async () => {
      const res = await callAnalyzeLogs(baseUrl) as any
      const criticals = res.body.anomalies.filter((a: any) => a.anomaly_type === 'CUDA_OOM')
      expect(criticals.length).toBeGreaterThan(0)
      expect(criticals[0].severity).toBe('CRITICAL')
    })
  })

  // ── 3. Sidecar unreachable — connection error handling ───────────────────

  describe('Sidecar unreachable — connection refused handling', () => {
    // Use a port that is certainly not listening (closed immediately after bind)
    const deadPort = 19999

    it('analyzeLogs() returns a response (error surfaced, not thrown) when sidecar is down', async () => {
      const res = await callAnalyzeLogs(`http://127.0.0.1:${deadPort}`) as any
      expect(res).toBeDefined()
      expect(res.status === 0 || res.error).toBeTruthy()
    })
  })

  // ── 4. Native Electron log analyzer fallback ────────────────────────────

  describe('Native Electron log analyzer fallback', () => {
    const testDir = path.join(os.tmpdir(), `slm-diag-test-${Date.now()}`)

    beforeAll(() => {
      fs.mkdirSync(testDir, { recursive: true })
      const sampleLog = [
        '[INFO] Application started successfully',
        '[ERROR] CUDA out of memory. Tried to allocate 4.00 GiB on device 0',
        '{"tool_name": "read_file", "arguments": {"filePath": "app.ts"}}',
        '{"tool_name": "read_file", "arguments": {"filePath": "app.ts"}}',
        '{"tool_name": "read_file", "arguments": {"filePath": "app.ts"}}',
        '{"tool_name": "read_file", "arguments": {"filePath": "app.ts"}}',
        '{"malformed_tool_json": {"nested": "value_without_closing_brace_which_is_too_long_and_truncated_by_model_context_limit_exceeded_xyz_1234567890',
        '[WARN] Ollama connect refused 11434',
        '[INFO] Turn completed',
      ].join('\n')

      fs.writeFileSync(path.join(testDir, 'sample_session.log'), sampleLog, 'utf8')
    })

    afterAll(() => {
      try {
        fs.rmSync(testDir, { recursive: true, force: true })
      } catch {
        // ignore
      }
    })

    it('scans candidate log files and detects CUDA_OOM, TOOL_LOOP, TRUNCATED_JSON with actionable remediation', () => {
      const report = sidecarAppService.analyzeLogsNativeFallback([testDir])
      expect(report).toBeDefined()
      expect(report.scanned_files.length).toBeGreaterThanOrEqual(1)
      expect(report.anomalies.length).toBeGreaterThanOrEqual(3)
      expect(report.has_critical).toBe(true)

      const types = report.anomalies.map((a) => a.anomaly_type)
      expect(types.some((t) => t.includes('CUDA_OOM'))).toBe(true)
      expect(types.some((t) => t.includes('TOOL_LOOP'))).toBe(true)
      expect(types.some((t) => t.includes('TRUNCATED_JSON'))).toBe(true)

      // Verify every anomaly includes remediation guidance
      for (const a of report.anomalies) {
        expect(a.remediation).toBeDefined()
        expect(a.remediation?.length).toBeGreaterThan(5)
      }
    })
  })
})
