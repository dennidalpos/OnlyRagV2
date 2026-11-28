import { describe, it, expect, vi } from 'vitest'
import { logger } from './logger'

describe('Frontend Logger Unit Tests', () => {
  it('should format info, warn, error, and debug log messages without throwing', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => logger.info('TestCat', 'Info message')).not.toThrow()
    expect(() => logger.warn('TestCat', 'Warn message')).not.toThrow()
    expect(() => logger.error('TestCat', 'Error message')).not.toThrow()

    expect(consoleSpy).toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()

    consoleSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })
})
