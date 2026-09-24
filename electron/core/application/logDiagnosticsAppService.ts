import path from 'node:path'
import os from 'node:os'
import { logger } from '../infrastructure/logging/logger'
import { documentIoRepository } from '../infrastructure/filesystem/documentIoRepository'
import { buildLogDiagnosticReport, scanLogLines } from '../domain/diagnostics/logAnomalyScanner'
import type { SlmAnomalyRecord, SlmLogDiagnosticReport } from '../../../shared/types'
import { errorMessage } from '../../../shared/domain/errors/errorMessage'

function candidateLogDirectories(extraPaths: string[] = []): string[] {
  const candidates: string[] = []
  const roaming = process.env.APPDATA
  const local = process.env.LOCALAPPDATA
  const home = os.homedir()
  if (roaming) candidates.push(path.join(roaming, 'onlyrag-v2', 'logs'), path.join(roaming, 'OnlyRagV2', 'logs'))
  if (local) candidates.push(path.join(local, 'OnlyRagV2', 'data'), path.join(local, 'OnlyRagV2', 'logs'), path.join(local, 'onlyrag-v2', 'logs'))
  candidates.push(path.join(home, '.onlyragv2', 'logs'), path.join(home, '.onlyragv2', 'data'), path.join(process.cwd(), 'logs'))
  return [...candidates, ...extraPaths]
}

/** Scans the app's log directories (plus any extra ones) for known failure signatures. */
export function analyzeLogs(extraPaths?: string[]): SlmLogDiagnosticReport {
  const { files, failures } = documentIoRepository.listFilesWithExtensions(candidateLogDirectories(extraPaths), ['.log', '.txt'])
  for (const failure of failures) logger.log('WARN', 'LogDiagnostics', `Cannot scan log directory ${failure.path}: ${failure.error}`)

  const scannedFiles: string[] = []
  const anomalies: SlmAnomalyRecord[] = []
  let totalLines = 0
  for (const logFile of files) {
    try {
      const lines = documentIoRepository.readText(logFile).split(/\r?\n/)
      scannedFiles.push(logFile)
      totalLines += lines.length
      anomalies.push(...scanLogLines(logFile, lines))
    } catch (err: unknown) {
      logger.log('WARN', 'LogDiagnostics', `Failed reading log file ${logFile}: ${errorMessage(err)}`)
    }
  }

  const report = buildLogDiagnosticReport(scannedFiles, totalLines, anomalies)
  logger.log('INFO', 'LogDiagnostics', `Log analysis: ${scannedFiles.length} files (${totalLines} lines) → ${anomalies.length} anomalies.`)
  return report
}
