/**
 * electron/core/application/sidecarSlmBridgeService.ts
 *
 * Application Layer — Sidecar SLM Bridge Service
 *
 * Provides a typed wrapper around the Python Sidecar's SLM log diagnostics endpoint:
 *   POST /agent/logs/analyze  → Log anomaly diagnostics with disk export
 *
 * All HTTP communication uses Node.js native `http` module (no external deps)
 * with keep-alive pooling, consistent with the existing SidecarAppService pattern.
 *
 * Layer: Application (orchestrates Infrastructure HTTP + Domain type mapping).
 * Zero UI logic, zero direct DB access.
 */

import http from 'node:http'
import { logger } from '../../diagnostics'
import type { SlmLogDiagnosticReport } from '../../../src/types'

const SIDECAR_BASE = 'http://127.0.0.1:8000'
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 4 })

// ---------------------------------------------------------------------------
// Internal HTTP helper (mirrors SidecarAppService pattern)
// ---------------------------------------------------------------------------

function postJson<T>(
  path: string,
  body: unknown,
  timeoutMs: number = 120_000
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  return new Promise((resolve) => {
    const postData = JSON.stringify(body)
    const req = http.request(
      `${SIDECAR_BASE}${path}`,
      {
        method: 'POST',
        agent: httpAgent,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      },
      (res) => {
        let raw = ''
        res.on('data', (chunk) => { raw += chunk })
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve({ success: true, data: JSON.parse(raw) as T })
            } catch (parseErr: any) {
              logger.log('ERROR', 'SidecarSlmBridge', `JSON parse error on ${path}: ${parseErr.message}`)
              resolve({ success: false, error: `Response parse error: ${parseErr.message}` })
            }
          } else {
            let detail = `HTTP ${res.statusCode}`
            try { detail = JSON.parse(raw)?.detail || detail } catch { /* ignore */ }
            logger.log('ERROR', 'SidecarSlmBridge', `Non-2xx from ${path}: ${detail}`)
            resolve({ success: false, error: detail })
          }
        })
      }
    )
    req.on('error', (err) => {
      logger.log('ERROR', 'SidecarSlmBridge', `HTTP error on ${path}: ${err.message}`)
      resolve({ success: false, error: `Sidecar connection error: ${err.message}` })
    })
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      logger.log('WARN', 'SidecarSlmBridge', `Request to ${path} timed out after ${timeoutMs}ms`)
      resolve({ success: false, error: `Request timed out after ${timeoutMs}ms` })
    })
    req.write(postData)
    req.end()
  })
}

// ---------------------------------------------------------------------------
// SidecarSlmBridgeService
// ---------------------------------------------------------------------------

export class SidecarSlmBridgeService {
  /**
   * Trigger log diagnostics analysis on the Python Sidecar.
   *
   * Scans OnlyRag V2 log files (AppData, LocalAppData, sidecar logs) and
   * returns structured anomaly detections. Additionally triggers server-side
   * export of diagnostics_report.json in AppData for offline debugging.
   *
   * @param extraPaths  Optional additional log directories to scan.
   */
  async analyzeLogs(extraPaths?: string[]): Promise<SlmLogDiagnosticReport | null> {
    logger.log('INFO', 'SidecarSlmBridge', 'Triggering log diagnostics analysis...')

    const res = await postJson<SlmLogDiagnosticReport>(
      '/agent/logs/analyze',
      { extra_paths: extraPaths ?? [] },
      30_000
    )

    if (!res.success) {
      logger.log('ERROR', 'SidecarSlmBridge', `Log analyze failed: ${res.error}`)
      return null
    }

    logger.log(
      'INFO', 'SidecarSlmBridge',
      `Log analysis: ${res.data.scanned_files.length} files, ${res.data.anomalies.length} anomalies. Critical: ${res.data.has_critical}`
    )
    return res.data
  }
}

export const sidecarSlmBridgeService = new SidecarSlmBridgeService()
