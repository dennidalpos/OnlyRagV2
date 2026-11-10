import { secureIpcMain as ipcMain } from './secureIpcMain'
import { appSettingsAppService } from '../application/appSettingsAppService'
import { chatHistoryRecoveryAppService } from '../application/chatHistoryRecoveryAppService'

export function registerSettingsIpcHandlers() {
  ipcMain.handle('chat:load-recovery', () => chatHistoryRecoveryAppService.load())
  ipcMain.handle('chat:save-recovery', (_, snapshot) => chatHistoryRecoveryAppService.save(snapshot))
  ipcMain.handle('settings:get', async () => {
    return appSettingsAppService.getSettings()
  })

  ipcMain.handle('settings:save', async (_, settings) => {
    return appSettingsAppService.saveSettings(settings)
  })
}
