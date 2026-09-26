import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { userDataRoot } from './userDataRoot'
import { logger } from '../logging/logger'
import type { AppSettings } from '../../../../shared/types'
import { sanitizeAppSettings } from '../../domain/settings/appSettingsDomain'
import { safeAtomicWrite } from './safeAtomicFileWriter'
import { errorMessage } from '../../../../shared/domain/errors/errorMessage'

const SETTINGS_FILE_NAME = 'settings.json'
const SETTINGS_FORMAT_VERSION = 2

/** Accepts only the versioned envelope `{ version, settings }` written by saveSettings. */
function decodeSettingsFile(value: unknown): AppSettings {
  const envelope = value && typeof value === 'object' && !Array.isArray(value) ? (value as { version?: unknown; settings?: unknown }) : {}
  if (envelope.version !== SETTINGS_FORMAT_VERSION) throw new Error('Unsupported settings version')
  return sanitizeAppSettings(envelope.settings)
}

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
    const baseDir = userDataRoot()
    return path.join(baseDir, SETTINGS_FILE_NAME)
  }

  /** Main-internal readers fall back to defaults when settings.json is missing or unreadable. */
  public async loadSettings(): Promise<AppSettings | null> {
    try {
      return await this.loadSettingsOrThrow()
    } catch {
      return null
    }
  }

  /**
   * Returns null only when no settings file exists. An unreadable or unsupported file throws,
   * so the renderer cannot mistake it for a first launch and overwrite it with defaults.
   */
  public async loadSettingsOrThrow(): Promise<AppSettings | null> {
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
      const settings = decodeSettingsFile(parsed)
      if (targetPath !== filePath) {
        await this.saveSettings(settings)
      }
      return settings
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      logger.log('WARN', 'AppSettingsRepo', `Failed reading settings from ${targetPath}: ${message}`)
      throw new Error(`Settings file is unreadable: ${message}`)
    }
  }

  public async saveSettings(settings: AppSettings): Promise<boolean> {
    const filePath = this.getStateFilePath()
    const sanitized = sanitizeAppSettings(settings)

    try {
      const payload = JSON.stringify({ version: SETTINGS_FORMAT_VERSION, settings: sanitized }, null, 2)
      return await safeAtomicWrite(filePath, payload)
    } catch (err: unknown) {
      logger.log('ERROR', 'AppSettingsRepo', `Failed writing settings to ${filePath}: ${errorMessage(err)}`)
      return false
    }
  }
}

export const appSettingsRepository = new AppSettingsRepository()
