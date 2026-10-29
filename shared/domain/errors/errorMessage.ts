/**
 * The message of anything a `catch` clause can receive, typed `unknown` instead of `any`: an
 * Error, a string, an IPC/HTTP error record or an arbitrary value.
 */
export function errorMessage(err: unknown): string {
  if (!err) return 'Unknown error'
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  if (typeof err === 'object') {
    const record = err as Record<string, unknown>
    for (const key of ['message', 'error', 'detail', 'statusText']) {
      if (typeof record[key] === 'string') return record[key] as string
    }
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }
  return String(err)
}

/** The Node.js error code (`ENOENT`, `EPERM`, ...) of a caught value, when it has one. */
export function errorCode(err: unknown): string | undefined {
  const code = err && typeof err === 'object' ? (err as { code?: unknown }).code : undefined
  return typeof code === 'string' ? code : undefined
}
