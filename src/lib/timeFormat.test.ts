import { describe, it, expect } from 'vitest'
import { formatClockTime, formatDateTime } from './timeFormat'

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
  })
})
