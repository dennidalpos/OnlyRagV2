import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { logger } from '../../../diagnostics'
import type { AppSettings } from '../../../../shared/types'
import { sanitizeAppSettings } from '../../domain/settings/appSettingsDomain'
import { safeAtomicWrite } from './safeAtomicFileWriter'

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
    let targetPath = filePath

    if (!fs.existsSync(targetPath)) {
      // Cross-folder fallback: check if settings exist under alternate AppData folder (OnlyRag V2 <-> onlyrag-v2)
      try {
        const appDataDir = app && typeof app.getPath === 'function' ? app.getPath('appData') : undefined
        if (appDataDir) {
          const alternateNames = ['OnlyRag V2', 'onlyrag-v2']
          for (const alt of alternateNames) {
            const candidate = path.join(appDataDir, alt, SETTINGS_FILE_NAME)
            if (candidate !== targetPath && fs.existsSync(candidate)) {
              logger.log('INFO', 'AppSettingsRepo', `Migrating existing settings from fallback location: ${candidate} -> ${targetPath}`)
              targetPath = candidate
              break
            }
          }
        }
      } catch {}
    }

    if (!fs.existsSync(targetPath)) {
      return null
    }

    try {
      const raw = await fs.promises.readFile(targetPath, 'utf-8')
      const parsed = JSON.parse(raw)
      const sanitized = sanitizeAppSettings(parsed)
      // If we read from a fallback location, save immediately to the canonical path
      if (targetPath !== filePath) {
        await this.saveSettings(sanitized)
      }
      return sanitized
    } catch (err: any) {
      logger.log('WARN', 'AppSettingsRepo', `Failed reading settings from ${targetPath}: ${err.message}`)
      return null
    }
  }

  public async saveSettings(settings: AppSettings): Promise<boolean> {
    const filePath = this.getStateFilePath()
    const sanitized = sanitizeAppSettings(settings)

    try {
      const payload = JSON.stringify(sanitized, null, 2)
      return await safeAtomicWrite(filePath, payload)
    } catch (err: any) {
      logger.log('ERROR', 'AppSettingsRepo', `Failed writing settings to ${filePath}: ${err.message}`)
      return false
    }
  }
}

export const appSettingsRepository = new AppSettingsRepository()
