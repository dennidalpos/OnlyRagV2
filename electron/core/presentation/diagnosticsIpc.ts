import { ipcMain } from 'electron'
import { runFullDiagnostics, logger, type LogLevel } from '../../diagnostics'
import { sidecarProcessManager } from '../infrastructure/process/sidecarProcessManager'

export function registerDiagnosticsIpcHandlers() {
  ipcMain.handle('diagnostics:run', async () => {
    await sidecarProcessManager.checkSidecarHealth()
    return await runFullDiagnostics(sidecarProcessManager.getSidecarState())
  })

  ipcMain.handle('diagnostics:get-logs', async () => {
    return logger.getLogs()
  })

  ipcMain.handle('diagnostics:clear-logs', async () => {
    logger.clearLogs()
    return true
  })

  ipcMain.handle('diagnostics:get-log-filepath', async () => {
    return logger.getLogFilePath()
  })

  ipcMain.handle('diagnostics:log-telemetry', async (_, level: LogLevel, category: string, message: string) => {
    logger.log(level, category, message)
    return true
  })
}
