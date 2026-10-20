import type { AppSettings } from '../../../../shared/types'
import { sanitizeAppSettings } from './appSettingsDomain'

export const SETTINGS_FORMAT_VERSION = 2

/** Decode the canonical envelope without importing Electron, logging or personal storage. */
export function decodeSettingsFile(value: unknown): AppSettings {
  const envelope = value && typeof value === 'object' && !Array.isArray(value) ? (value as { version?: unknown; settings?: unknown }) : {}
  if (envelope.version !== SETTINGS_FORMAT_VERSION || !envelope.settings || typeof envelope.settings !== 'object' || Array.isArray(envelope.settings)) {
    throw new Error('Unsupported settings version or invalid settings object')
  }
  return sanitizeAppSettings(envelope.settings)
}
