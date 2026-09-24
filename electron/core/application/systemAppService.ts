import { documentIoRepository } from '../infrastructure/filesystem/documentIoRepository'
import type { DesktopShellPort } from '../domain/ports/desktopShellPort'
import { electronDesktopShell } from '../infrastructure/electron/electronDesktopShell'
import { logger } from '../infrastructure/logging/logger'
import { systemStorageRepository } from '../infrastructure/filesystem/systemStorageRepository'
import { appSettingsRepository } from '../infrastructure/filesystem/appSettingsRepository'
import { isLoopbackTarget } from '../domain/agent/localOnlyPolicy'
import { estimateModelWeightGB } from '../../../shared/domain/hardware/modelWeightEstimator'
import type { AppSettings } from '../../../shared/types'
import { isAllowedExternalUrl } from '../../navigationPolicy'
import { errorMessage } from '../../../shared/domain/errors/errorMessage'

export interface DiskSpaceCheckResult {
  allowed: boolean
  requiredGB: number
  freeGB: number
  missingGB: number
  error?: string
}

export interface SettingsLoader {
  loadSettings: () => Promise<AppSettings | null> | AppSettings | null
}

/** shell.openPath launches files with their default handler, so only folders may be opened. */
const isExistingDirectory = (targetPath: string): boolean => documentIoRepository.isDirectory(targetPath)

export class SystemAppService {
  constructor(
    private readonly settingsRepo: SettingsLoader = appSettingsRepository,
    private readonly desktop: Pick<DesktopShellPort, 'openExternal' | 'openPath' | 'showOpenDialog'> = electronDesktopShell,
    private readonly isDirectory: (targetPath: string) => boolean = isExistingDirectory,
  ) {}

  getOllamaStoragePath(): string {
    return systemStorageRepository.getOllamaStoragePath()
  }

  estimateModelSizeBytes(modelName: string): number {
    const weightGB = estimateModelWeightGB(modelName)
    return Math.round(weightGB * 1024 * 1024 * 1024)
  }

  getDiskFreeSpace(targetPath?: string): { freeBytes: number; totalBytes: number } {
    const dir = targetPath || this.getOllamaStoragePath()
    return (
      systemStorageRepository.getDiskFreeSpace(dir) || {
        freeBytes: 100 * 1024 * 1024 * 1024,
        totalBytes: 500 * 1024 * 1024 * 1024,
      }
    )
  }

  validateModelDownloadSpace(models: string[]): DiskSpaceCheckResult {
    try {
      const { freeBytes } = this.getDiskFreeSpace()
      const freeGB = Number((freeBytes / (1024 * 1024 * 1024)).toFixed(2))

      let requiredBytes = 0
      for (const m of models) {
        if (m && m.trim()) {
          requiredBytes += this.estimateModelSizeBytes(m.trim())
        }
      }

      const safetyBufferBytes = 2 * 1024 * 1024 * 1024
      const totalNeededBytes = requiredBytes + safetyBufferBytes
      const requiredGB = Number((requiredBytes / (1024 * 1024 * 1024)).toFixed(2))

      const allowed = freeBytes >= totalNeededBytes
      const missingBytes = Math.max(0, totalNeededBytes - freeBytes)
      const missingGB = Number((missingBytes / (1024 * 1024 * 1024)).toFixed(2))

      logger.log('INFO', 'SystemApp', `Disk space check: Free=${freeGB}GB, Required=${requiredGB}GB, Allowed=${allowed}`)

      return {
        allowed,
        requiredGB,
        freeGB,
        missingGB,
      }
    } catch (err: unknown) {
      logger.log('ERROR', 'SystemApp', `Disk space check failed: ${errorMessage(err)}`)
      return {
        allowed: false,
        requiredGB: 0,
        freeGB: 0,
        missingGB: 0,
        error: errorMessage(err),
      }
    }
  }

  async openFileDialog(options?: { title?: string; filters?: { name: string; extensions: string[] }[] }) {
    return this.desktop.showOpenDialog({
      title: options?.title || 'Select Documents to Import',
      properties: ['openFile', 'multiSelections'],
      filters: options?.filters || [
        {
          name: 'Supported Documents',
          extensions: ['pdf', 'png', 'jpg', 'jpeg', 'docx', 'txt', 'md'],
        },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
  }

  async openDirectoryDialog(options?: { title?: string }) {
    const [directory] = await this.desktop.showOpenDialog({
      title: options?.title || 'Select Workspace Directory',
      properties: ['openDirectory'],
    })
    return directory ?? null
  }

  async openExternal(url: string): Promise<boolean> {
    if (isAllowedExternalUrl(url)) {
      const settings = await this.settingsRepo.loadSettings()
      if (settings?.capabilityPolicyMode === 'offline-strict') return false
      if (settings?.capabilityPolicyMode === 'local-only' && !isLoopbackTarget(url)) return false
      await this.desktop.openExternal(url)
      return true
    }
    return false
  }

  async openPath(targetPath: string): Promise<boolean> {
    const trimmed = typeof targetPath === 'string' ? targetPath.trim() : ''
    if (!trimmed || !this.isDirectory(trimmed)) return false
    await this.desktop.openPath(trimmed)
    return true
  }
}

export const systemAppService = new SystemAppService()
