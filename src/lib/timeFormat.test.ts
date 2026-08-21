import { describe, it, expect } from 'vitest'
import { formatClockTime, formatDateTime, formatRelativeTime } from './timeFormat'

describe('timeFormat Unit Tests', () => {
  it('should format an ISO 8601 timestamp as local clock time', () => {
    const iso = new Date(2026, 2, 15, 14, 32, 11).toISOString()
    const formatted = formatClockTime(iso)

    expect(formatted).not.toBe(iso)
    expect(formatted).toMatch(/\d{1,2}[:.]\d{2}[:.]\d{2}/)
  })

  it('should format an ISO 8601 timestamp as local date and clock time', () => {
    const iso = new Date(2026, 2, 15, 14, 32, 11).toISOString()
    const formatted = formatDateTime(iso)

    expect(formatted).toContain(new Date(iso).toLocaleDateString())
    expect(formatted).toMatch(/\d{1,2}[:.]\d{2}/)
  })

  it('should return legacy non-ISO values untouched instead of rendering "Invalid Date"', () => {
    // Values written before the ISO migration (toLocaleTimeString) are unparsable.
    expect(formatClockTime('14:32')).toBe('14:32')
    expect(formatDateTime('14:32')).toBe('14:32')
    expect(formatClockTime('not a date')).toBe('not a date')
  })

  it('should render a dash for missing timestamps', () => {
    expect(formatClockTime(undefined)).toBe('—')
    expect(formatClockTime('')).toBe('—')
    expect(formatDateTime(null)).toBe('—')
    expect(formatRelativeTime(undefined)).toBe('—')
  })

  it('should format relative timestamps with Intl.RelativeTimeFormat', () => {
    const now = Date.now()
    const fiveMinutesAgo = new Date(now - 5 * 60 * 1000).toISOString()
    const formatted = formatRelativeTime(fiveMinutesAgo, 'en')
    expect(formatted).toContain('5 minutes ago')

    const yesterday = new Date(now - 24 * 3600 * 1000).toISOString()
    const formattedYesterday = formatRelativeTime(yesterday, 'en')
    expect(formattedYesterday).toContain('yesterday')
  })
})
