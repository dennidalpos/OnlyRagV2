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

  ipcMain.handle('sessions:recovery-list', async (_event, payload) => sessionHistoryAppService.listDeletionRecovery(payload?.offset))

  ipcMain.handle('sessions:recovery-action', async (_event, payload) => {
    if (payload.action === 'retry') return sessionHistoryAppService.retryDeletion(payload.operationId)
    if (payload.action === 'restore') return sessionHistoryAppService.restoreDeletion(payload.operationId)
    if (!payload.destinationDirectory) return { status: 'refused', operationId: payload.operationId, error: 'Export destination is required' }
    const exportPath = await sessionHistoryAppService.exportDeletion(payload.operationId, payload.destinationDirectory)
    return { status: 'pending', operationId: payload.operationId, exportPath }
  })
}
