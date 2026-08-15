import { ipcMain, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
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

  ipcMain.handle('diagnostics:open-logs-folder', async () => {
    const logFilePath = logger.getLogFilePath()
    const logsDir = path.dirname(logFilePath)
    if (!fs.existsSync(logsDir)) {
      try {
        fs.mkdirSync(logsDir, { recursive: true })
      } catch {}
    }
    await shell.openPath(logsDir)
    return { success: true, path: logsDir }
  })
}
