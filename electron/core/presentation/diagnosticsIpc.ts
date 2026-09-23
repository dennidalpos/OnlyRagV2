import { secureIpcMain as ipcMain } from './secureIpcMain'
import { type LogLevel } from '../infrastructure/logging/logger'
import { runFullDiagnostics } from '../../diagnostics'
import { diagnosticsAppService } from '../application/diagnosticsAppService'
import { sidecarAppService } from '../application/sidecarAppService'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'

export function registerDiagnosticsIpcHandlers() {

  ipcMain.handle('diagnostics:run', async (_, host?: string) => {
    const sidecarState = await sidecarAppService.checkHealth()
    return await runFullDiagnostics(sidecarState, host)
  })

  ipcMain.handle('diagnostics:get-logs', async () => {
    return diagnosticsAppService.getLogs()
  })

  ipcMain.handle('diagnostics:clear-logs', async () => {
    diagnosticsAppService.clearLogs()
    return true
  })

  ipcMain.handle('diagnostics:clear-agent-audit-log', async () => {
    return codingAgentLogger.clearAuditLog()
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
