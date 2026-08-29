import type { AppSettings } from '../../../shared/types'
import { AppSettingsRepository, appSettingsRepository } from '../infrastructure/filesystem/appSettingsRepository'
import { sanitizeAppSettings } from '../domain/settings/appSettingsDomain'

export class AppSettingsAppService {
  constructor(private readonly repo: AppSettingsRepository = appSettingsRepository) {}

  public async getSettings(): Promise<AppSettings | null> {
    return this.repo.loadSettings()
  }

  public async saveSettings(settings: AppSettings): Promise<boolean> {
    const sanitized = sanitizeAppSettings(settings)
    return this.repo.saveSettings(sanitized)
  }
}

export const appSettingsAppService = new AppSettingsAppService()
