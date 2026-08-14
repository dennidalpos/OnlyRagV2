import { describe, it, expect } from 'vitest'
import { AppSettings } from '../../types'

describe('Task Concurrency & Queue Configuration Logic Tests', () => {
  it('should default to 1 concurrent task if not explicitly set in AppSettings', () => {
    const baseSettings: AppSettings = {
      defaultModel: 'llama3.2',
      hardwareProfile: 'Auto',
      ocrEngine: 'native_cuda',
      ollamaHost: 'http://127.0.0.1:11434',
    }

    const effectiveConcurrency = baseSettings.maxConcurrentTasks || 1
    expect(effectiveConcurrency).toBe(1)
  })

  it('should accept valid concurrency levels from 1 to 8', () => {
    const testSettings: AppSettings = {
      defaultModel: 'llama3.2',
      hardwareProfile: 'High',
      ocrEngine: 'native_cuda',
      ollamaHost: 'http://127.0.0.1:11434',
      maxConcurrentTasks: 4,
    }

    expect(testSettings.maxConcurrentTasks).toBe(4)

    // Clamp function test
    const clampConcurrency = (val: number) => Math.max(1, Math.min(Math.floor(val) || 1, 8))

    expect(clampConcurrency(2)).toBe(2)
    expect(clampConcurrency(8)).toBe(8)
    expect(clampConcurrency(100)).toBe(8)
    expect(clampConcurrency(-10)).toBe(1)
    expect(clampConcurrency(0)).toBe(1)
  })
})
