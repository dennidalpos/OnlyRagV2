import fs from 'node:fs'
import path from 'node:path'
import { errorCode } from '../../../../shared/domain/errors/errorMessage'

/** Per-path sequential write queue to prevent concurrent in-process write-write collisions. */
const fileWriteQueues = new Map<string, Promise<void>>()

/** @internal */
export function pendingAtomicWritePathCount(): number {
  return fileWriteQueues.size
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const RETRY_ERRORS = new Set(['EPERM', 'EBUSY', 'EACCES'])

/** Atomically writes a file with per-path serialization and Windows lock retries. */
export async function safeAtomicWrite(filePath: string, content: string | Buffer): Promise<boolean> {
  const normalizedPath = path.resolve(filePath)
  const previousOp = fileWriteQueues.get(normalizedPath) || Promise.resolve()

  const currentOp = (async () => {
    await previousOp

    const dir = path.dirname(normalizedPath)
    await fs.promises.mkdir(dir, { recursive: true })

    const tempPath = `${normalizedPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    let failure: { error: unknown } | undefined

    try {
      await fs.promises.writeFile(tempPath, content, 'utf-8')

      let renamed = false
      let attempts = 0
      const maxAttempts = 5

      while (!renamed && attempts < maxAttempts) {
        try {
          await fs.promises.rename(tempPath, normalizedPath)
          renamed = true
        } catch (err: unknown) {
          attempts++
          if (!RETRY_ERRORS.has(errorCode(err) || '') || attempts >= maxAttempts) throw err
          await delay(15 * Math.pow(2, attempts - 1))
        }
      }
    } catch (error: unknown) {
      failure = { error }
    } finally {
      try {
        await fs.promises.unlink(tempPath)
      } catch (error: unknown) {
        if (errorCode(error) !== 'ENOENT') {
          failure = { error: failure ? new AggregateError([failure.error, error], 'Atomic write and staging cleanup failed') : error }
        }
      }
    }
    if (failure) throw failure.error
    return true
  })()

  // Only the tail absorbs failure; callers still receive the rejected write.
  const settled = currentOp.then(
    () => undefined,
    () => undefined,
  )
  fileWriteQueues.set(normalizedPath, settled)
  try {
    return await currentOp
  } finally {
    if (fileWriteQueues.get(normalizedPath) === settled) fileWriteQueues.delete(normalizedPath)
  }
}
