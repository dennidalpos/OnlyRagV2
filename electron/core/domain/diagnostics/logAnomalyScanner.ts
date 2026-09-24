import type { SlmAnomalyRecord, SlmLogDiagnosticReport } from '../../../../shared/types'

const TRUNCATED_JSON = /(\{|\[)[^}\]]{80,}$/
const LINE_PATTERNS: Array<{ re: RegExp; subType: string; isCritical: boolean }> = [
  { re: /CUDA out of memory|RuntimeError.*CUDA/i, subType: 'CUDA_OOM', isCritical: true },
  { re: /vram.{0,20}(exceeded|full)|out of vram|gpu.*memory.*full/i, subType: 'VRAM_EXCEEDED', isCritical: true },
  { re: /HTTP 504|Gateway Timeout|timed out/i, subType: 'GATEWAY_TIMEOUT', isCritical: false },
  { re: /"response"\s*:\s*""/i, subType: 'EMPTY_RESPONSE', isCritical: false },
  { re: /Ollama(?!_)\w*.*?(timed out|timeout(?!\s*:))|connect.*refused.*11434/i, subType: 'OLLAMA_TIMEOUT', isCritical: false },
  { re: /Circuit breaker tripped|Recursion limit reached|Infinite loop detected/i, subType: 'CIRCUIT_BREAKER', isCritical: true },
  { re: /EPERM: operation not permitted|EACCES: permission denied/i, subType: 'FS_PERMISSIONS', isCritical: false },
]
const TOOL_NAME = /"tool_name"\s*:\s*"([^"]+)"/g
const TOOL_LOOP_WINDOW_LINES = 30
const TOOL_LOOP_THRESHOLD = 3
const SNIPPET_CHARS = 120

export function anomalyRemediation(anomalyType: string): string {
  if (anomalyType.includes('CUDA_OOM') || anomalyType.includes('VRAM_EXCEEDED')) {
    return 'Memoria VRAM GPU esaurita. Riduci il context window (num_ctx: 8192 o 4096) o seleziona un modello con quantizzazione più compatta (es. q4_k_m).'
  }
  if (anomalyType.includes('TRUNCATED_JSON')) {
    return 'Risposta JSON del modello troncata o non valida. Aumenta num_ctx o passa a un modello coding dedicato (es. qwen2.5-coder:7b).'
  }
  if (anomalyType.includes('TOOL_LOOP')) {
    return "Loop di chiamate identiche rilevato. Riformula il prompt o interrompi l'agente per evitare consumo inutile di token."
  }
  if (anomalyType.includes('GATEWAY_TIMEOUT') || anomalyType.includes('OLLAMA_TIMEOUT')) {
    return 'Connessione a Ollama o Sidecar scaduta o rifiutata. Verifica che il demone Ollama sia attivo sulla porta 11434.'
  }
  if (anomalyType.includes('CIRCUIT_BREAKER')) {
    return "Intervento del Circuit Breaker di sicurezza: l'esecuzione è stata arrestata per prevenire loop infiniti."
  }
  if (anomalyType.includes('FS_PERMISSIONS')) {
    return 'Errore nei permessi del filesystem (EPERM/EACCES). Assicurati che OnlyRag abbia i permessi di scrittura nel workspace.'
  }
  return "Controlla i log completi e verifica la corretta configurazione dell'ambiente di esecuzione."
}

function lineAnomaly(logFile: string, lineIndex: number, line: string, anomalyType: string, severity: SlmAnomalyRecord['severity']): SlmAnomalyRecord {
  return {
    anomaly_type: anomalyType,
    severity,
    log_file: logFile,
    line_number: lineIndex + 1,
    snippet: line.trim().slice(0, SNIPPET_CHARS),
    count: 1,
    remediation: anomalyRemediation(anomalyType),
  }
}

/** A tool named at least TOOL_LOOP_THRESHOLD times within one window, reported once per stretch of overlapping windows. */
function toolLoopAnomalies(logFile: string, lines: string[]): SlmAnomalyRecord[] {
  const anomalies: SlmAnomalyRecord[] = []
  const reportedUntil = new Map<string, number>()
  for (let start = 0; start < lines.length; start++) {
    const counts = new Map<string, number>()
    for (const line of lines.slice(start, start + TOOL_LOOP_WINDOW_LINES)) {
      for (const match of line.matchAll(TOOL_NAME)) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1)
    }
    for (const [toolName, count] of counts) {
      if (count < TOOL_LOOP_THRESHOLD || start <= (reportedUntil.get(toolName) ?? -1)) continue
      reportedUntil.set(toolName, start + TOOL_LOOP_WINDOW_LINES - 1)
      anomalies.push({
        anomaly_type: 'TOOL_LOOP',
        severity: 'CRITICAL',
        log_file: logFile,
        line_number: start + 1,
        snippet: `Tool '${toolName}' chiamato ${count}x in una finestra di ${TOOL_LOOP_WINDOW_LINES} righe.`,
        count,
        remediation: anomalyRemediation('TOOL_LOOP'),
      })
    }
  }
  return anomalies
}

/** Anomalies of one log file: truncated JSON, GPU/connection/permission failures and tool-call loops. */
export function scanLogLines(logFile: string, lines: string[]): SlmAnomalyRecord[] {
  const anomalies: SlmAnomalyRecord[] = []
  lines.forEach((line, index) => {
    if (TRUNCATED_JSON.test(line)) anomalies.push(lineAnomaly(logFile, index, line, 'TRUNCATED_JSON', 'ERROR'))
  })
  lines.forEach((line, index) => {
    const pattern = LINE_PATTERNS.find((candidate) => candidate.re.test(line))
    if (pattern) anomalies.push(lineAnomaly(logFile, index, line, `VRAM_THRASH:${pattern.subType}`, pattern.isCritical ? 'CRITICAL' : 'ERROR'))
  })
  return [...anomalies, ...toolLoopAnomalies(logFile, lines)]
}

export function buildLogDiagnosticReport(scannedFiles: string[], totalLines: number, anomalies: SlmAnomalyRecord[]): SlmLogDiagnosticReport {
  const counts = new Map<string, number>()
  for (const anomaly of anomalies) counts.set(anomaly.anomaly_type, (counts.get(anomaly.anomaly_type) ?? 0) + 1)
  return {
    scanned_files: scannedFiles,
    total_lines_scanned: totalLines,
    anomalies,
    has_critical: anomalies.some((anomaly) => anomaly.severity === 'CRITICAL'),
    summary:
      anomalies.length === 0
        ? 'Nessuna anomalia rilevata — log di sistema puliti.'
        : `Anomalie rilevate — ${Array.from(counts, ([type, count]) => `${type}: ${count}`).join(', ')}`,
  }
}
