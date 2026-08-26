import fs from 'node:fs'
import path from 'node:path'

/** Per-path sequential write queue to prevent concurrent in-process write-write collisions. */
const fileWriteQueues = new Map<string, Promise<unknown>>()

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const RETRY_ERRORS = new Set(['EPERM', 'EBUSY', 'EACCES'])

/**
 * Windows-resilient atomic file write.
 *
 * Guarantees:
 * 1. Writes to a unique temp sibling file first (`.tmp-<pid>-<time>-<rand>`).
 * 2. Queues concurrent writes to the same destination path strictly in serial.
 * 3. Retries rename operations up to 5 times with exponential backoff on transient Windows locks (EPERM / EBUSY / EACCES).
 * 4. Falls back to copyFile + unlink if rename is disallowed by the OS.
 * 5. Cleans up temporary files in all execution paths.
 */
export async function safeAtomicWrite(filePath: string, content: string | Buffer): Promise<boolean> {
  const normalizedPath = path.resolve(filePath)
  const previousOp = fileWriteQueues.get(normalizedPath) || Promise.resolve()

  const currentOp = (async () => {
    try {
      await previousOp
    } catch {
      // Ignore previous operation failure; this operation should still attempt to write.
    }

    const dir = path.dirname(normalizedPath)
    await fs.promises.mkdir(dir, { recursive: true })

    const tempPath = `${normalizedPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    try {
      await fs.promises.writeFile(tempPath, content, 'utf-8')

      let renamed = false
      let attempts = 0
      const maxAttempts = 5

      while (!renamed && attempts < maxAttempts) {
        try {
          await fs.promises.rename(tempPath, normalizedPath)
          renamed = true
        } catch (err: any) {
          attempts++
          if (RETRY_ERRORS.has(err?.code) && attempts < maxAttempts) {
            await delay(15 * Math.pow(2, attempts - 1))
          } else {
            // If rename fails persistently on Windows, try copyFile fallback
            try {
              await fs.promises.copyFile(tempPath, normalizedPath)
              renamed = true
            } catch {
              throw err // Throw original rename error if fallback fails
            }
          }
        }
      }

      return true
    } finally {
      // Ensure temp file is purged if it still exists
      try {
        if (fs.existsSync(tempPath)) {
          await fs.promises.unlink(tempPath)
        }
      } catch {}
    }
  })()

  fileWriteQueues.set(
    normalizedPath,
    currentOp.then(
      () => {
        if (fileWriteQueues.get(normalizedPath) === currentOp) {
          fileWriteQueues.delete(normalizedPath)
        }
      },
      () => {
        if (fileWriteQueues.get(normalizedPath) === currentOp) {
          fileWriteQueues.delete(normalizedPath)
        }
      }
    )
  )

  return currentOp
}
