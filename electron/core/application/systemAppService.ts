import { dialog, BrowserWindow, shell } from 'electron'
import { logger } from '../../diagnostics'
import { systemStorageRepository } from '../infrastructure/filesystem/systemStorageRepository'
import { appSettingsRepository } from '../infrastructure/filesystem/appSettingsRepository'
import { isLoopbackTarget } from '../domain/agent/localOnlyPolicy'
import { estimateModelWeightGB } from '../../../shared/domain/hardware/modelWeightEstimator'
import type { AppSettings } from '../../../shared/types'

export interface DiskSpaceCheckResult {
  allowed: boolean
  requiredGB: number
  freeGB: number
  missingGB: number
  error?: string
}

export interface ShellAdapter {
  openExternal: (url: string) => Promise<void>
  openPath: (path: string) => Promise<string>
}

export interface SettingsLoader {
  loadSettings: () => Promise<AppSettings | null> | AppSettings | null
}

export class SystemAppService {
  constructor(
    private readonly settingsRepo: SettingsLoader = appSettingsRepository,
    private readonly shellAdapter: ShellAdapter = shell
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
    } catch (err: any) {
      logger.log('ERROR', 'SystemApp', `Disk space check failed: ${err.message}`)
      return {
        allowed: false,
        requiredGB: 0,
        freeGB: 0,
        missingGB: 0,
        error: err.message,
      }
    }
  }

  async openFileDialog(win: BrowserWindow | null, options?: { title?: string; filters?: { name: string; extensions: string[] }[] }) {
    if (!win) return []
    const res = await dialog.showOpenDialog(win, {
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
    return res.canceled ? [] : res.filePaths
  }

  async openDirectoryDialog(win: BrowserWindow | null, options?: { title?: string }) {
    if (!win) return null
    const res = await dialog.showOpenDialog(win, {
      title: options?.title || 'Select Workspace Directory',
      properties: ['openDirectory'],
    })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  }

  async openExternal(url: string): Promise<boolean> {
    if (url && (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('mailto:'))) {
      const settings = await this.settingsRepo.loadSettings()
      if (settings?.capabilityPolicyMode === 'offline-strict') return false
      if (settings?.capabilityPolicyMode === 'local-only' && !isLoopbackTarget(url)) return false
      await this.shellAdapter.openExternal(url)
      return true
    }
    return false
  }

  async openPath(targetPath: string): Promise<boolean> {
    if (targetPath && typeof targetPath === 'string' && targetPath.trim()) {
      await this.shellAdapter.openPath(targetPath.trim())
      return true
    }
    return false
  }
}

export const systemAppService = new SystemAppService()
