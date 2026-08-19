import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { logger } from '../../../diagnostics'

export class SystemStorageRepository {
  getOllamaStoragePath(): string {
    if (process.env.OLLAMA_MODELS && fs.existsSync(process.env.OLLAMA_MODELS)) {
      return process.env.OLLAMA_MODELS
    }
    const homeDir = process.env.USERPROFILE || process.env.HOME || ''
    const standardOllamaModelsDir = path.join(homeDir, '.ollama', 'models')
    if (fs.existsSync(standardOllamaModelsDir)) {
      return standardOllamaModelsDir
    }
    if (fs.existsSync(homeDir)) {
      return homeDir
    }
    try {
      return app.getPath('userData')
    } catch {
      return process.platform === 'win32' ? 'C:\\' : '/'
    }
  }

  getDiskFreeSpace(dir: string): { freeBytes: number; totalBytes: number } | null {
    try {
      if (fs.statfsSync) {
        const stats = fs.statfsSync(dir)
        const freeBytes = stats.bavail * stats.bsize
        const totalBytes = stats.blocks * stats.bsize
        return { freeBytes, totalBytes }
      }
    } catch (err: any) {
      logger.log('WARN', 'SystemStorageRepo', `fs.statfsSync failed for ${dir}: ${err.message}`)
    }
    return null
  }
}

export const systemStorageRepository = new SystemStorageRepository()
