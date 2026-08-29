import { ipcMain } from 'electron'
import { sessionHistoryAppService } from '../application/sessionHistoryAppService'
import type { CodingSession } from '../../../shared/types'

export function registerSessionHistoryIpcHandlers() {
  ipcMain.handle('sessions:list', async (_event: unknown, workspacePath?: string | null) => {
    return sessionHistoryAppService.listSessions(workspacePath)
  })

  ipcMain.handle('sessions:save', async (_event: unknown, session: CodingSession) => {
    return sessionHistoryAppService.saveSession(session)
  })

  ipcMain.handle('sessions:delete', async (_event: unknown, sessionId: string, workspacePath?: string | null) => {
    return sessionHistoryAppService.deleteSession(sessionId, workspacePath)
  })

  ipcMain.handle('sessions:clear', async (_event: unknown, workspacePath?: string | null) => {
    return sessionHistoryAppService.clearSessions(workspacePath)
  })

  ipcMain.handle('sessions:migrate-legacy', async (_event: unknown, rawSessions: unknown) => {
    return sessionHistoryAppService.migrateLegacySessions(rawSessions)
  })
}
