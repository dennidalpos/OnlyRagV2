import { secureIpcMain as ipcMain } from './secureIpcMain'
import { sessionHistoryAppService } from '../application/sessionHistoryAppService'

export function registerSessionHistoryIpcHandlers() {
  ipcMain.handle('sessions:list', async (_event, payload) => {
    return sessionHistoryAppService.listSessions(payload?.workspacePath)
  })

  ipcMain.handle('sessions:save', async (_event, session) => {
    return sessionHistoryAppService.saveSession(session)
  })

  ipcMain.handle('sessions:delete', async (_event, { sessionId, workspacePath }) => {
    return sessionHistoryAppService.deleteSession(sessionId, workspacePath)
  })

  ipcMain.handle('sessions:clear', async (_event, payload) => {
    return sessionHistoryAppService.clearSessions(payload?.workspacePath)
  })

  ipcMain.handle('sessions:migrate-legacy', async (_event, { sessions }) => {
    return sessionHistoryAppService.migrateLegacySessions(sessions)
  })
}
