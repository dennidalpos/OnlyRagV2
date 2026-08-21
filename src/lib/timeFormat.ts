/**
 * Display formatting for the ISO 8601 timestamps persisted by the agent and by the
 * session history. Values that are not valid ISO strings (records written before the
 * ISO migration) are returned untouched instead of rendering as "Invalid Date".
 */

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

/**
 * Formats a timestamp into a human-readable relative time string
 * (e.g. "5 minutes ago", "yesterday", "in 2 hours") using standard Intl.RelativeTimeFormat.
 */
export function formatRelativeTime(
  timestamp: string | Date | number | undefined | null,
  locale: string = 'en'
): string {
  if (!timestamp) return '—'
  const date =
    timestamp instanceof Date
      ? timestamp
      : typeof timestamp === 'number'
      ? new Date(timestamp)
      : parseIso(timestamp)

  if (!date) return typeof timestamp === 'string' ? timestamp : '—'

  const now = Date.now()
  const diffSec = Math.round((date.getTime() - now) / 1000)

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  const intervals = [
    { unit: 'year', seconds: 31536000 },
    { unit: 'month', seconds: 2592000 },
    { unit: 'week', seconds: 604800 },
    { unit: 'day', seconds: 86400 },
    { unit: 'hour', seconds: 3600 },
    { unit: 'minute', seconds: 60 },
    { unit: 'second', seconds: 1 },
  ] as const

  for (const { unit, seconds } of intervals) {
    if (Math.abs(diffSec) >= seconds || unit === 'second') {
      const value = Math.round(diffSec / seconds)
      return rtf.format(value, unit)
    }
  }

  return 'just now'
}
