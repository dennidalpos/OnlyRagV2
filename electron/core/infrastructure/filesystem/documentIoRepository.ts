import fs from 'node:fs'
import { logger } from '../../../diagnostics'

/** Thin, unvalidated filesystem primitives (existence checks, raw writes) for callers that already hold a resolved path. */
export class DocumentIoRepository {
  exists(targetPath: string): boolean {
    return fs.existsSync(targetPath)
  }

  writeText(targetPath: string, content: string): { success: boolean; error?: string } {
    try {
      fs.writeFileSync(targetPath, content, 'utf-8')
      return { success: true }
    } catch (err: any) {
      logger.log('ERROR', 'DocumentIoRepo', `Failed writing text file '${targetPath}': ${err.message}`)
      return { success: false, error: err.message }
    }
  }

  writeBuffer(targetPath: string, buffer: Buffer): { success: boolean; error?: string } {
    try {
      fs.writeFileSync(targetPath, buffer)
      return { success: true }
    } catch (err: any) {
      logger.log('ERROR', 'DocumentIoRepo', `Failed writing binary file '${targetPath}': ${err.message}`)
      return { success: false, error: err.message }
    }
  }
}

export const documentIoRepository = new DocumentIoRepository()
