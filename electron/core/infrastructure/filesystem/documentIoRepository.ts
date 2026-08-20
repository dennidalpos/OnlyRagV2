import fs from 'node:fs'
import { logger } from '../../../diagnostics'

/** Thin, unvalidated filesystem primitives (existence checks, raw writes) for callers that already hold a resolved path. */
export class DocumentIoRepository {
  exists(targetPath: string): boolean {
    return fs.existsSync(targetPath)
  }

  /**
   * Writes to a `.tmp` sibling of `targetPath` first, then renames it into place — the same
   * write-temp-then-swap discipline already used for PDF in-place translation
   * (sidecar/domain/translator.py's `file_path + ".translating.tmp"` + `os.replace()`), so a
   * write that fails partway (disk full, process killed) never leaves `targetPath` itself
   * truncated or corrupted. The temp file lives next to the target, not in a separate OS temp
   * directory, so the final `rename` stays on the same volume and is atomic.
   */
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
