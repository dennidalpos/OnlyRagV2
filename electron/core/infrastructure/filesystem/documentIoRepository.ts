import fs from 'node:fs'
import { logger } from '../logging/logger'
import { errorMessage } from '../../../../shared/domain/errors/errorMessage'

/** Unvalidated filesystem primitives for callers with resolved paths. */
export class DocumentIoRepository {
  exists(targetPath: string): boolean {
    return fs.existsSync(targetPath)
  }

  isDirectory(targetPath: string): boolean {
    try {
      return fs.statSync(targetPath).isDirectory()
    } catch {
      return false
    }
  }

  isFile(targetPath: string): boolean {
    try {
      return fs.statSync(targetPath).isFile()
    } catch {
      return false
    }
  }

  isWritable(targetPath: string): boolean {
    try {
      fs.accessSync(targetPath, fs.constants.W_OK)
      return true
    } catch {
      return false
    }
  }

  /** Throws when the file is missing or unreadable. */
  readText(targetPath: string): string {
    return fs.readFileSync(targetPath, 'utf-8')
  }

  /** Throws when the file is missing or unreadable. */
  readBytes(targetPath: string): Buffer {
    return fs.readFileSync(targetPath)
  }

  ensureDirectory(targetPath: string): void {
    fs.mkdirSync(targetPath, { recursive: true })
  }

  /** Automatic exports must never replace an existing destination, including a concurrent writer's. */
  createExportFile(targetPath: string, content: string | Buffer): { success: boolean; error?: string; collision?: boolean } {
    let descriptor: number | undefined
    let ownedFile: fs.Stats | undefined
    try {
      descriptor = fs.openSync(targetPath, 'wx')
      ownedFile = fs.fstatSync(descriptor)
      fs.writeFileSync(descriptor, content, 'utf8')
      fs.fsyncSync(descriptor)
      fs.closeSync(descriptor)
      descriptor = undefined
      return { success: true }
    } catch (err: unknown) {
      const collision = !ownedFile && descriptor === undefined && (err as NodeJS.ErrnoException).code === 'EEXIST'
      if (descriptor !== undefined) {
        try {
          fs.closeSync(descriptor)
        } catch {
          /* Preserve the original write failure. */
        }
      }
      if (ownedFile) {
        try {
          const current = fs.lstatSync(targetPath)
          if (current.dev === ownedFile.dev && current.ino === ownedFile.ino) fs.unlinkSync(targetPath)
        } catch {
          /* An unremovable partial export remains identifiable at its unique path. */
        }
      }
      return { success: false, error: errorMessage(err), collision }
    }
  }

  /** Explicitly chosen destinations use a temporary sibling before replacement. */
  writeText(targetPath: string, content: string): { success: boolean; error?: string } {
    const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`
    try {
      fs.writeFileSync(tmpPath, content, 'utf-8')
      fs.renameSync(tmpPath, targetPath)
      return { success: true }
    } catch (err: unknown) {
      try {
        fs.unlinkSync(tmpPath)
      } catch {
        /* best-effort cleanup, tmpPath may not exist */
      }
      logger.log('ERROR', 'DocumentIoRepo', `Failed writing text file '${targetPath}': ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    }
  }

  /** See writeText's temp-then-rename discipline. */
  writeBuffer(targetPath: string, buffer: Buffer): { success: boolean; error?: string } {
    const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`
    try {
      fs.writeFileSync(tmpPath, buffer)
      fs.renameSync(tmpPath, targetPath)
      return { success: true }
    } catch (err: unknown) {
      try {
        fs.unlinkSync(tmpPath)
      } catch {
        /* best-effort cleanup, tmpPath may not exist */
      }
      logger.log('ERROR', 'DocumentIoRepo', `Failed writing binary file '${targetPath}': ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    }
  }
}

export const documentIoRepository = new DocumentIoRepository()
