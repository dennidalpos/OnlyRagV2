import type { IElectronAPI } from '../types'
import { translate } from '../i18n/I18nContext'
import { logger } from '../lib/logger'
import { errorMessage } from '../../shared/domain/errors/errorMessage'

/** The preload bridge. Outside Electron it throws, so a caller never mistakes a missing bridge for an empty result. */
export function electronApi(): IElectronAPI {
  if (!window.electronAPI) throw new Error(translate('services.electronApiUnavailable'))
  return window.electronAPI
}

/** Opens the Main log folder. The buttons that call it have no status area, so a failure goes to the log. */
export async function openLogsFolder(): Promise<void> {
  try {
    const res = await electronApi().openLogsFolder()
    if (!res.success) logger.error('LogsFolder', `Cannot open the logs folder: ${res.error}`)
  } catch (err: unknown) {
    logger.error('LogsFolder', `Cannot open the logs folder: ${errorMessage(err)}`)
  }
}
