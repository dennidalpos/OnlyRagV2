import type { AppSettings } from '../../../shared/types'
import { normalizeOllamaHost } from '../../../shared/domain/ollamaHost'
import { AppSettingsRepository, appSettingsRepository } from '../infrastructure/filesystem/appSettingsRepository'
import { sidecarProcessManager } from '../infrastructure/process/sidecarProcessManager'
import { sanitizeAppSettings } from '../domain/settings/appSettingsDomain'
import { logger } from '../infrastructure/logging/logger'

interface SidecarLifecycle {
  getLaunchedOllamaHost(): string | null
  restartPythonSidecar(): Promise<boolean>
}

/** The remote-host field saves on every keystroke; restart once the value has settled. */
const SIDECAR_RESTART_SETTLE_MS = 1500

export class AppSettingsAppService {
  private pendingRestart: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly repo: AppSettingsRepository = appSettingsRepository,
    private readonly sidecar: SidecarLifecycle = sidecarProcessManager,
    private readonly restartSettleMs: number = SIDECAR_RESTART_SETTLE_MS,
  ) {}

  /** Rejects when settings.json exists but cannot be read, so the renderer never replaces it with defaults. */
  public async getSettings(): Promise<AppSettings | null> {
    return this.repo.loadSettingsOrThrow()
  }

  public async saveSettings(settings: AppSettings): Promise<boolean> {
    const sanitized = sanitizeAppSettings(settings)
    const saved = await this.repo.saveSettings(sanitized)
    if (saved) this.restartSidecarOnOllamaHostChange(sanitized.ollamaHost)
    return saved
  }

  /** The sidecar reads its Ollama host from the environment at launch, so a host change needs a restart. */
  private restartSidecarOnOllamaHostChange(ollamaHost?: string): void {
    if (this.pendingRestart) clearTimeout(this.pendingRestart)
    this.pendingRestart = setTimeout(() => {
      this.pendingRestart = null
      const launchedHost = this.sidecar.getLaunchedOllamaHost()
      if (launchedHost === null || launchedHost === normalizeOllamaHost(ollamaHost)) return
      logger.log('INFO', 'Settings', `Ollama host changed (${launchedHost} -> ${normalizeOllamaHost(ollamaHost)}); restarting the sidecar.`)
      void this.sidecar
        .restartPythonSidecar()
        .catch((err: Error) => logger.log('ERROR', 'Settings', `Sidecar restart after Ollama host change failed: ${err.message}`))
    }, this.restartSettleMs)
  }
}

export const appSettingsAppService = new AppSettingsAppService()
