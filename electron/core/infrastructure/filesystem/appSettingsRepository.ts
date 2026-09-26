import fs from 'node:fs'
import path from 'node:path'
import { userDataRoot } from './userDataRoot'
import { logger } from '../logging/logger'
import type { AppSettings } from '../../../../shared/types'
import { sanitizeAppSettings } from '../../domain/settings/appSettingsDomain'
import { safeAtomicWrite } from './safeAtomicFileWriter'
import { errorMessage } from '../../../../shared/domain/errors/errorMessage'

const SETTINGS_FILE_NAME = 'settings.json'
const SETTINGS_FORMAT_VERSION = 2

/**
 * Accepts only the versioned envelope `{ version, settings }` written by saveSettings.
 * @internal Also read by the live harness (scripts/live), which loads the user's real settings.
 */
export function decodeSettingsFile(value: unknown): AppSettings {
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
    if (!fs.existsSync(filePath)) {
      return null
    }

    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8')
      return decodeSettingsFile(JSON.parse(raw))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      logger.log('WARN', 'AppSettingsRepo', `Failed reading settings from ${filePath}: ${message}`)
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
