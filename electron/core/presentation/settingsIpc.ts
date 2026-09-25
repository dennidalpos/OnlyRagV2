import { secureIpcMain as ipcMain } from './secureIpcMain'
import { appSettingsAppService } from '../application/appSettingsAppService'

export function registerSettingsIpcHandlers() {
  ipcMain.handle('settings:get', async () => {
    return appSettingsAppService.getSettings()
  })

  ipcMain.handle('settings:save', async (_, settings) => {
    return appSettingsAppService.saveSettings(settings)
  })
}
