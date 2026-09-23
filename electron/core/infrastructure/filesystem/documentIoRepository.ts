import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../logging/logger'

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

  async removeDirectory(targetPath: string): Promise<void> {
    await fs.promises.rm(targetPath, { recursive: true, force: true })
  }

  /** Expands each existing path to itself (file) or its direct children matching `extensions` (directory). */
  listFilesWithExtensions(paths: string[], extensions: readonly string[]): { files: string[]; failures: { path: string; error: string }[] } {
    const files: string[] = []
    const failures: { path: string; error: string }[] = []
    for (const candidate of paths) {
      if (!fs.existsSync(candidate)) continue
      try {
        const stat = fs.statSync(candidate)
        if (stat.isFile()) {
          files.push(candidate)
        } else if (stat.isDirectory()) {
          for (const entry of fs.readdirSync(candidate, { withFileTypes: true })) {
            if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) files.push(path.join(candidate, entry.name))
          }
        }
      } catch (err: unknown) {
        failures.push({ path: candidate, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return { files: Array.from(new Set(files)), failures }
  }

  /** Writes to a `.tmp` sibling of `targetPath` first, then renames it into place — the same write-temp-then-swap discipline already used for PDF in-place translation (sidecar/domain/translator.py's `file_path + ".translating.tmp"` + `os.replace()`), so a write tha */
  writeText(targetPath: string, content: string): { success: boolean; error?: string } {
    const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`
    try {
      fs.writeFileSync(tmpPath, content, 'utf-8')
      fs.renameSync(tmpPath, targetPath)
      return { success: true }
    } catch (err: any) {
      try { fs.unlinkSync(tmpPath) } catch { /* best-effort cleanup, tmpPath may not exist */ }
      logger.log('ERROR', 'DocumentIoRepo', `Failed writing text file '${targetPath}': ${err.message}`)
      return { success: false, error: err.message }
    }
  }

  /** See writeText's temp-then-rename discipline. */
  writeBuffer(targetPath: string, buffer: Buffer): { success: boolean; error?: string } {
    const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`
    try {
      fs.writeFileSync(tmpPath, buffer)
      fs.renameSync(tmpPath, targetPath)
      return { success: true }
    } catch (err: any) {
      try { fs.unlinkSync(tmpPath) } catch { /* best-effort cleanup, tmpPath may not exist */ }
      logger.log('ERROR', 'DocumentIoRepo', `Failed writing binary file '${targetPath}': ${err.message}`)
      return { success: false, error: err.message }
    }
  }
}

export const documentIoRepository = new DocumentIoRepository()
