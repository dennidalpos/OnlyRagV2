import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../logging/logger'
import { errorCode, errorMessage } from '../../../../shared/domain/errors/errorMessage'

export class SystemStorageRepository {
  getOllamaStoragePath(): string {
    if (process.env.OLLAMA_MODELS) {
      return process.env.OLLAMA_MODELS
    }
    const homeDir = process.env.USERPROFILE || process.env.HOME
    if (!homeDir || !path.isAbsolute(homeDir)) throw new Error('Local model storage path is unavailable')
    return path.join(homeDir, '.ollama', 'models')
  }

  getDiskFreeSpace(dir: string): { freeBytes: number; totalBytes: number } | null {
    try {
      if (!path.isAbsolute(dir)) throw new Error('Model storage must be an absolute path')
      // A new model directory may not exist yet. Probe only an existing ancestor
      // of that destination; never substitute the profile or another drive.
      let probe = dir
      while (true) {
        try {
          if (!fs.statSync(probe).isDirectory()) throw new Error('Model storage is not a directory')
          break
        } catch (err: unknown) {
          const parent = path.dirname(probe)
          if (errorCode(err) !== 'ENOENT' || parent === probe) throw err
          try {
            if (fs.lstatSync(probe).isSymbolicLink()) throw new Error('Model storage contains an unresolved link')
          } catch (linkError: unknown) {
            if (errorCode(linkError) !== 'ENOENT') throw linkError
          }
          probe = parent
        }
      }
      if (fs.statfsSync) {
        const stats = fs.statfsSync(probe)
        const freeBytes = stats.bavail * stats.bsize
        const totalBytes = stats.blocks * stats.bsize
        return { freeBytes, totalBytes }
      }
    } catch (err: unknown) {
      logger.log('WARN', 'SystemStorageRepo', `fs.statfsSync failed for ${dir}: ${errorMessage(err)}`)
    }
    return null
  }
}

export const systemStorageRepository = new SystemStorageRepository()
