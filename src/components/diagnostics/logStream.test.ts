import { describe, expect, it } from 'vitest'
import type { LogEntry } from '../../types'
import { isSameLogSnapshot, logEntryKeys } from './logStream'

const entry = (timestamp: string, message: string): LogEntry => ({ timestamp, level: 'INFO', category: 'Test', message })

describe('diagnostics log stream', () => {
  it('detects an unchanged polled buffer and any append or rotation', () => {
    const logs = [entry('t1', 'a'), entry('t2', 'b')]
    expect(isSameLogSnapshot(logs, [...logs])).toBe(true)
    expect(isSameLogSnapshot(logs, [...logs, entry('t3', 'c')])).toBe(false)
    expect(isSameLogSnapshot(logs, [entry('t2', 'b'), entry('t3', 'c')])).toBe(false)
    expect(isSameLogSnapshot([], [])).toBe(true)
  })

  it('keeps row keys stable when older entries leave the buffer and disambiguates duplicates', () => {
    const before = logEntryKeys([entry('t1', 'a'), entry('t2', 'b'), entry('t2', 'b')])
    const after = logEntryKeys([entry('t2', 'b'), entry('t2', 'b')])
    expect(new Set(before).size).toBe(3)
    expect(after).toEqual(before.slice(1))
  })
})
