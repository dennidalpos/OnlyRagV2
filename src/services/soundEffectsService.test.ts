// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { SoundEffectsService } from './soundEffectsService'

type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext }

describe('SoundEffectsService Unit Tests', () => {
  let mockOscillator: object
  let mockGain: object
  let mockAudioContext: Record<string, unknown> & { createOscillator: Mock }
  const webkitWindow = window as WindowWithWebkitAudio
  const originalAudioContext = window.AudioContext
  const originalWebkitAudioContext = webkitWindow.webkitAudioContext

  beforeEach(() => {
    mockOscillator = {
      type: '',
      frequency: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }

    mockGain = {
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    }

    mockAudioContext = {
      currentTime: 10,
      state: 'running',
      destination: {},
      createOscillator: vi.fn().mockImplementation(() => ({ ...mockOscillator })),
      createGain: vi.fn().mockImplementation(() => ({ ...mockGain })),
      resume: vi.fn().mockResolvedValue(undefined),
    }

    function MockAudioContext() {
      return mockAudioContext
    }

    window.AudioContext = MockAudioContext as never
    webkitWindow.webkitAudioContext = MockAudioContext as never
  })

  afterEach(() => {
    window.AudioContext = originalAudioContext
    webkitWindow.webkitAudioContext = originalWebkitAudioContext
  })

  it('should not play sound when enabled is false', () => {
    const service = new SoundEffectsService()
    service.play('error', false)
    expect(mockAudioContext.createOscillator).not.toHaveBeenCalled()
  })

  it('should synthesize error tone correctly', () => {
    const service = new SoundEffectsService()
    service.play('error', true)
    expect(mockAudioContext.createOscillator).toHaveBeenCalled()
  })

  it('should synthesize interactive chime correctly', () => {
    const service = new SoundEffectsService()
    service.play('interactive', true)
    expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(2)
  })

  it('should synthesize completion arpeggio correctly', () => {
    const service = new SoundEffectsService()
    service.play('completion', true)
    expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(3)
  })

  it('should synthesize step tick correctly', () => {
    const service = new SoundEffectsService()
    service.play('step', true)
    expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(1)
  })
})
