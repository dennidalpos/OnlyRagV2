import { ipcMain } from 'electron'
import { appSettingsAppService } from '../application/appSettingsAppService'
import type { AppSettings } from '../../../src/types'

export function registerSettingsIpcHandlers() {
  ipcMain.handle('settings:get', async () => {
    return appSettingsAppService.getSettings()
  })

  ipcMain.handle('settings:save', async (_, settings: AppSettings) => {
    return appSettingsAppService.saveSettings(settings)
  })
}
