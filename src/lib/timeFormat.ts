function parseIso(isoTimestamp: string | undefined | null): Date | null {
  if (!isoTimestamp) return null
  const parsed = Date.parse(isoTimestamp)
  return Number.isNaN(parsed) ? null : new Date(parsed)
}

/** Clock time (HH:MM:SS) for action log entries. */
export function formatClockTime(isoTimestamp: string | undefined | null): string {
  const date = parseIso(isoTimestamp)
  if (!date) return isoTimestamp || '—'
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** Date and clock time (locale date + HH:MM) for session and prompt history entries. */
export function formatDateTime(isoTimestamp: string | undefined | null): string {
  const date = parseIso(isoTimestamp)
  if (!date) return isoTimestamp || '—'
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}
