import { describe, expect, it } from 'vitest'
import {
  MAX_DOWNLOAD_BYTES,
  MAX_FILE_READ_BYTES,
  MAX_PROJECT_MAP_DEPTH,
  MAX_PROJECT_MAP_ITEMS,
  MAX_RECURSIVE_LIST_ITEMS,
  MAX_SEARCH_FILE_BYTES,
  MAX_SEARCH_MATCHES,
} from './ioLimits'

describe('shared I/O limits', () => {
  it('keeps bounded positive ceilings for reads and downloads', () => {
    expect(MAX_FILE_READ_BYTES).toBe(50 * 1024 * 1024)
    expect(MAX_DOWNLOAD_BYTES).toBe(100 * 1024 * 1024)
    expect(MAX_DOWNLOAD_BYTES).toBeGreaterThan(MAX_FILE_READ_BYTES)
    expect(MAX_SEARCH_FILE_BYTES).toBe(10 * 1024 * 1024)
    expect(MAX_SEARCH_MATCHES).toBe(1000)
    expect(MAX_PROJECT_MAP_ITEMS).toBe(10000)
    expect(MAX_PROJECT_MAP_DEPTH).toBe(12)
    expect(MAX_RECURSIVE_LIST_ITEMS).toBe(150)
  })
})
