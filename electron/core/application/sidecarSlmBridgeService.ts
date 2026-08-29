import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { logger } from '../../diagnostics'
import type { SlmLogDiagnosticReport } from '../../../shared/types'

const SIDECAR_BASE = 'http://127.0.0.1:8000'
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 4 })

// ---------------------------------------------------------------------------
// Internal HTTP helper (mirrors SidecarAppService pattern)
// ---------------------------------------------------------------------------

function postJson<T>(
  pathStr: string,
  body: unknown,
  timeoutMs: number = 120_000
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  return new Promise((resolve) => {
    const postData = JSON.stringify(body)
    const req = http.request(
      `${SIDECAR_BASE}${pathStr}`,
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
              logger.log('ERROR', 'SidecarSlmBridge', `JSON parse error on ${pathStr}: ${parseErr.message}`)
              resolve({ success: false, error: `Response parse error: ${parseErr.message}` })
            }
          } else {
            let detail = `HTTP ${res.statusCode}`
            try { detail = JSON.parse(raw)?.detail || detail } catch { /* ignore */ }
            logger.log('ERROR', 'SidecarSlmBridge', `Non-2xx from ${pathStr}: ${detail}`)
            resolve({ success: false, error: detail })
          }
        })
      }
    )
    req.on('error', (err) => {
      logger.log('ERROR', 'SidecarSlmBridge', `HTTP error on ${pathStr}: ${err.message}`)
      resolve({ success: false, error: `Sidecar connection error: ${err.message}` })
    })
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      logger.log('WARN', 'SidecarSlmBridge', `Request to ${pathStr} timed out after ${timeoutMs}ms`)
      resolve({ success: false, error: `Request timed out after ${timeoutMs}ms` })
    })
    req.write(postData)
    req.end()
  })
}

// ---------------------------------------------------------------------------
// Anomaly Remediation Guidance
// ---------------------------------------------------------------------------

function getAnomalyRemediation(anomalyType: string): string {
  if (anomalyType.includes('CUDA_OOM') || anomalyType.includes('VRAM_EXCEEDED')) {
    return 'Memoria VRAM GPU esaurita. Riduci il context window (num_ctx: 8192 o 4096) o seleziona un modello con quantizzazione più compatta (es. q4_k_m).'
  }
  if (anomalyType.includes('TRUNCATED_JSON')) {
    return 'Risposta JSON del modello troncata o non valida. Aumenta num_ctx o passa a un modello coding dedicato (es. qwen2.5-coder:7b).'
  }
  if (anomalyType.includes('TOOL_LOOP')) {
    return 'Loop di chiamate identiche rilevato. Riformula il prompt o interrompi l\'agente per evitare consumo inutile di token.'
  }
  if (anomalyType.includes('GATEWAY_TIMEOUT') || anomalyType.includes('OLLAMA_TIMEOUT')) {
    return 'Connessione a Ollama o Sidecar scaduta o rifiutata. Verifica che il demone Ollama sia attivo sulla porta 11434.'
  }
  if (anomalyType.includes('CIRCUIT_BREAKER')) {
    return 'Intervento del Circuit Breaker di sicurezza: l\'esecuzione è stata arrestata per prevenire loop infiniti.'
  }
  if (anomalyType.includes('FS_PERMISSIONS')) {
    return 'Errore nei permessi del filesystem (EPERM/EACCES). Assicurati che OnlyRag abbia i permessi di scrittura nel workspace.'
  }
  return 'Controlla i log completi e verifica la corretta configurazione dell\'ambiente di esecuzione.'
}

// ---------------------------------------------------------------------------
// SidecarSlmBridgeService
// ---------------------------------------------------------------------------

export class SidecarSlmBridgeService {
  /**
   * Trigger log diagnostics analysis.
   * Attempts Python sidecar /agent/logs/analyze first. If sidecar is offline or unreachable,
   * falls back seamlessly to Node.js native log scanning engine so diagnostics never fail.
   *
   * @param extraPaths  Optional additional log directories to scan.
   */
  async analyzeLogs(extraPaths?: string[]): Promise<SlmLogDiagnosticReport | null> {
    logger.log('INFO', 'SidecarSlmBridge', 'Triggering log diagnostics analysis...')

    const res = await postJson<SlmLogDiagnosticReport>(
      '/agent/logs/analyze',
      { extra_paths: extraPaths ?? [] },
      15_000
    )

    if (res.success && res.data) {
      logger.log(
        'INFO', 'SidecarSlmBridge',
        `Sidecar log analysis: ${res.data.scanned_files.length} files, ${res.data.anomalies.length} anomalies. Critical: ${res.data.has_critical}`
      )
      return res.data
    }

    const failureReason = !res.success ? res.error : 'unknown sidecar response'
    logger.log('WARN', 'SidecarSlmBridge', `Sidecar analysis unavailable (${failureReason}), switching to native Electron log scanner fallback...`)
    return this.analyzeLogsNativeFallback(extraPaths)
  }

  /**
   * Native Node.js log diagnostics engine fallback.
   */
  analyzeLogsNativeFallback(extraPaths?: string[]): SlmLogDiagnosticReport {
    const report: SlmLogDiagnosticReport = {
      scanned_files: [],
      total_lines_scanned: 0,
      anomalies: [],
      has_critical: false,
      summary: '',
    }

    const candidatePaths = this.getCandidateLogPaths(extraPaths)
    const logFiles = this.collectLogFiles(candidatePaths)

    const truncatedJsonRe = /(\{|\[)[^}\]]{80,}$/
    const vramPatterns: Array<{ re: RegExp; subType: string; isCritical: boolean }> = [
      { re: /CUDA out of memory|RuntimeError.*CUDA/i, subType: 'CUDA_OOM', isCritical: true },
      { re: /vram.{0,20}(exceeded|full)|out of vram|gpu.*memory.*full/i, subType: 'VRAM_EXCEEDED', isCritical: true },
      { re: /HTTP 504|Gateway Timeout|timed out/i, subType: 'GATEWAY_TIMEOUT', isCritical: false },
      { re: /"response"\s*:\s*""/i, subType: 'EMPTY_RESPONSE', isCritical: false },
      { re: /Ollama(?!_)\w*.*?(timed out|timeout(?!\s*:))|connect.*refused.*11434/i, subType: 'OLLAMA_TIMEOUT', isCritical: false },
      { re: /Circuit breaker tripped|Recursion limit reached|Infinite loop detected/i, subType: 'CIRCUIT_BREAKER', isCritical: true },
      { re: /EPERM: operation not permitted|EACCES: permission denied/i, subType: 'FS_PERMISSIONS', isCritical: false },
    ]
    const toolExtractRe = /"tool_name"\s*:\s*"([^"]+)"/g

    for (const logPath of logFiles) {
      try {
        const raw = fs.readFileSync(logPath, 'utf8')
        const lines = raw.split(/\r?\n/)
        report.scanned_files.push(logPath)
        report.total_lines_scanned += lines.length

        // 1. Truncated JSON
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          if (truncatedJsonRe.test(line)) {
            report.anomalies.push({
              anomaly_type: 'TRUNCATED_JSON',
              severity: 'ERROR',
              log_file: logPath,
              line_number: i + 1,
              snippet: line.trim().slice(0, 120),
              count: 1,
              remediation: getAnomalyRemediation('TRUNCATED_JSON'),
            })
          }
        }

        // 2. VRAM & Connection Failures
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          for (const pat of vramPatterns) {
            if (pat.re.test(line)) {
              const fullType = `VRAM_THRASH:${pat.subType}`
              report.anomalies.push({
                anomaly_type: fullType,
                severity: pat.isCritical ? 'CRITICAL' : 'ERROR',
                log_file: logPath,
                line_number: i + 1,
                snippet: line.trim().slice(0, 120),
                count: 1,
                remediation: getAnomalyRemediation(fullType),
              })
              break
            }
          }
        }

        // 3. Tool Calling Loops (Sliding Window of 30 lines)
        const windowSize = 30
        const loopThreshold = 3
        const reportedLoops = new Set<string>()

        for (let start = 0; start < lines.length; start++) {
          const window = lines.slice(start, start + windowSize)
          const toolCounts: Record<string, number> = {}

          for (const wline of window) {
            let match: RegExpExecArray | null
            while ((match = toolExtractRe.exec(wline)) !== null) {
              const tool = match[1]
              toolCounts[tool] = (toolCounts[tool] || 0) + 1
            }
          }

          for (const [toolName, count] of Object.entries(toolCounts)) {
            if (count >= loopThreshold) {
              const loopKey = `${start}:${toolName}`
              if (!reportedLoops.has(loopKey)) {
                reportedLoops.add(loopKey)
                report.anomalies.push({
                  anomaly_type: 'TOOL_LOOP',
                  severity: 'CRITICAL',
                  log_file: logPath,
                  line_number: start + 1,
                  snippet: `Tool '${toolName}' chiamato ${count}x in una finestra di ${windowSize} righe.`,
                  count,
                  remediation: getAnomalyRemediation('TOOL_LOOP'),
                })
              }
            }
          }
        }
      } catch (err: any) {
        logger.log('WARN', 'SidecarSlmBridge', `Failed reading log file ${logPath}: ${err.message}`)
      }
    }

    report.has_critical = report.anomalies.some((a) => a.severity === 'CRITICAL')
    if (report.anomalies.length === 0) {
      report.summary = 'Nessuna anomalia rilevata — log di sistema puliti.'
    } else {
      const counts: Record<string, number> = {}
      for (const a of report.anomalies) {
        counts[a.anomaly_type] = (counts[a.anomaly_type] || 0) + 1
      }
      report.summary = `Anomalie rilevate — ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ')}`
    }

    logger.log(
      'INFO', 'SidecarSlmBridge',
      `Native fallback log analysis: ${report.scanned_files.length} files (${report.total_lines_scanned} lines) → ${report.anomalies.length} anomalies.`
    )
    return report
  }

  private getCandidateLogPaths(extraPaths?: string[]): string[] {
    const candidates: string[] = []
    const roaming = process.env.APPDATA
    const local = process.env.LOCALAPPDATA
    const home = os.homedir()

    if (roaming) {
      candidates.push(path.join(roaming, 'onlyrag-v2', 'logs'))
      candidates.push(path.join(roaming, 'OnlyRagV2', 'logs'))
    }
    if (local) {
      candidates.push(path.join(local, 'OnlyRagV2', 'data'))
      candidates.push(path.join(local, 'OnlyRagV2', 'logs'))
      candidates.push(path.join(local, 'onlyrag-v2', 'logs'))
    }
    candidates.push(path.join(home, '.onlyragv2', 'logs'))
    candidates.push(path.join(home, '.onlyragv2', 'data'))
    candidates.push(path.join(process.cwd(), 'logs'))

    if (extraPaths && Array.isArray(extraPaths)) {
      candidates.push(...extraPaths)
    }

    return candidates
  }

  private collectLogFiles(dirs: string[]): string[] {
    const files: string[] = []
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue
      try {
        const stat = fs.statSync(dir)
        if (stat.isFile()) {
          files.push(dir)
        } else if (stat.isDirectory()) {
          const entries = fs.readdirSync(dir, { withFileTypes: true })
          for (const ent of entries) {
            if (ent.isFile() && (ent.name.endsWith('.log') || ent.name.endsWith('.txt'))) {
              files.push(path.join(dir, ent.name))
            }
          }
        }
      } catch (err: any) {
        logger.log('WARN', 'SidecarSlmBridge', `Cannot scan log directory ${dir}: ${err.message}`)
      }
    }
    return Array.from(new Set(files))
  }
}

export const sidecarSlmBridgeService = new SidecarSlmBridgeService()

