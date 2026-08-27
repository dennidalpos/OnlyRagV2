import { shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { logger, type LogEntry, type LogLevel } from '../../diagnostics'
import { httpMetrics, type HttpMetricSnapshot } from '../infrastructure/http/httpMetrics'

export class DiagnosticsAppService {
  public getHttpMetrics(): HttpMetricSnapshot[] {
    return httpMetrics.snapshot()
  }

  public getLogs(): LogEntry[] {
    return logger.getLogs()
  }

  public clearLogs(): void {
    logger.clearLogs()
  }

  public getLogFilePath(): string {
    return logger.getLogFilePath()
  }

  public logTelemetry(level: LogLevel, category: string, message: string): void {
    logger.log(level, category, message)
  }

  public async openLogsFolder(): Promise<{ success: boolean; path: string }> {
    const logsDir = path.dirname(this.getLogFilePath())
    if (!fs.existsSync(logsDir)) {
      try {
        fs.mkdirSync(logsDir, { recursive: true })
      } catch {
        // Opening the path below provides the same best-effort behavior as before.
      }
    }
    await shell.openPath(logsDir)
    return { success: true, path: logsDir }
  }
}

export const diagnosticsAppService = new DiagnosticsAppService()
