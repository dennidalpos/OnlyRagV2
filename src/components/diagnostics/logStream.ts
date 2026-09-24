import type { LogEntry } from '../../types'

/**
 * True when a polled log buffer holds the same entries as the one on screen. The Main buffer is
 * append-only and capped (oldest entries drop), so equal length with equal first and last entries
 * means nothing changed and the drawer can skip re-rendering the whole console.
 */
export function isSameLogSnapshot(current: readonly LogEntry[], next: readonly LogEntry[]): boolean {
  if (current.length !== next.length) return false
  if (current.length === 0) return true
  return sameEntry(current[0], next[0]) && sameEntry(current[current.length - 1], next[next.length - 1])
}

function sameEntry(left: LogEntry, right: LogEntry): boolean {
  return left.timestamp === right.timestamp && left.level === right.level && left.category === right.category && left.message === right.message
}

/**
 * Stable React keys for log rows: the entry's own identity plus an occurrence counter for exact
 * duplicates, so a row keeps its key when older entries are dropped from the front of the buffer.
 */
export function logEntryKeys(logs: readonly LogEntry[]): string[] {
  const seen = new Map<string, number>()
  return logs.map((log) => {
    const base = `${log.timestamp}|${log.level}|${log.category}|${log.message.slice(0, 120)}`
    const occurrence = seen.get(base) ?? 0
    seen.set(base, occurrence + 1)
    return occurrence === 0 ? base : `${base}#${occurrence}`
  })
}
