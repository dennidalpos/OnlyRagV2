import { ipcMain } from 'electron'
import { runFullDiagnostics, type LogLevel } from '../../diagnostics'
import { diagnosticsAppService } from '../application/diagnosticsAppService'
import { sidecarAppService } from '../application/sidecarAppService'

export function registerDiagnosticsIpcHandlers() {
  ipcMain.handle('diagnostics:get-http-metrics', () => diagnosticsAppService.getHttpMetrics())

  ipcMain.handle('diagnostics:run', async () => {
    const sidecarState = await sidecarAppService.checkHealth()
    return await runFullDiagnostics(sidecarState)
  })

  ipcMain.handle('diagnostics:get-logs', async () => {
    return diagnosticsAppService.getLogs()
  })

  ipcMain.handle('diagnostics:clear-logs', async () => {
    diagnosticsAppService.clearLogs()
    return true
  })

  ipcMain.handle('diagnostics:get-log-filepath', async () => {
    return diagnosticsAppService.getLogFilePath()
  })

  ipcMain.handle('diagnostics:log-telemetry', async (_, level: LogLevel, category: string, message: string) => {
    diagnosticsAppService.logTelemetry(level, category, message)
    return true
  })

  ipcMain.handle('diagnostics:open-logs-folder', async () => {
    return diagnosticsAppService.openLogsFolder()
  })
}
