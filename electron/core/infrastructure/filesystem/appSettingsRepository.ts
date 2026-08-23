import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { logger } from '../../../diagnostics'
import type { AppSettings } from '../../../../src/types'
import { sanitizeAppSettings } from '../../domain/settings/appSettingsDomain'

const SETTINGS_FILE_NAME = 'settings.json'

/**
 * Single canonical filesystem store for AppSettings under Electron userData,
 * ensuring synchronization across development (http://localhost:5173) and packaged (file://) runtimes.
 */
export class AppSettingsRepository {
  private readonly stateFilePath?: string

  constructor(customStateDir?: string) {
    if (customStateDir) {
      this.stateFilePath = path.join(customStateDir, SETTINGS_FILE_NAME)
    }
  }

  private getStateFilePath(): string {
    if (this.stateFilePath) return this.stateFilePath
    const baseDir = app && typeof app.getPath === 'function' ? app.getPath('userData') : path.join(process.cwd(), 'userdata_dev')
    return path.join(baseDir, SETTINGS_FILE_NAME)
  }

  public async loadSettings(): Promise<AppSettings | null> {
    const filePath = this.getStateFilePath()
    if (!fs.existsSync(filePath)) {
      return null
    }

    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      return sanitizeAppSettings(parsed)
    } catch (err: any) {
      logger.log('WARN', 'AppSettingsRepo', `Failed reading settings from ${filePath}: ${err.message}`)
      return null
    }
  }

  public async saveSettings(settings: AppSettings): Promise<boolean> {
    const filePath = this.getStateFilePath()
    const sanitized = sanitizeAppSettings(settings)

    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      const tempPath = `${filePath}.tmp-${Date.now()}`
      await fs.promises.writeFile(tempPath, JSON.stringify(sanitized, null, 2), 'utf-8')
      await fs.promises.rename(tempPath, filePath)
      return true
    } catch (err: any) {
      logger.log('ERROR', 'AppSettingsRepo', `Failed writing settings to ${filePath}: ${err.message}`)
      return false
    }
  }
}

export const appSettingsRepository = new AppSettingsRepository()
