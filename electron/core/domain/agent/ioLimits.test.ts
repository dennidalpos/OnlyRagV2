import { describe, expect, it } from 'vitest'
import { MAX_DOWNLOAD_BYTES, MAX_FILE_READ_BYTES } from './ioLimits'

describe('shared I/O limits', () => {
  it('keeps bounded positive ceilings for reads and downloads', () => {
    expect(MAX_FILE_READ_BYTES).toBe(50 * 1024 * 1024)
    expect(MAX_DOWNLOAD_BYTES).toBe(100 * 1024 * 1024)
    expect(MAX_DOWNLOAD_BYTES).toBeGreaterThan(MAX_FILE_READ_BYTES)
  })
})
