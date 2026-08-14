import { describe, it, expect } from 'vitest'
import {
  resolveModelKeepAlive,
  isModelLoaded,
  DEFAULT_LIFECYCLE_CONFIG,
  type RunningModelInfo,
} from './lifecycleCoordinator'

describe('Ollama Model Lifecycle Coordinator Domain Unit Tests', () => {
  it('should resolve correct keep_alive string according to task scope', () => {
    expect(resolveModelKeepAlive('primary_pinned')).toBe('30m')
    expect(resolveModelKeepAlive('standard')).toBe('5m')
    expect(resolveModelKeepAlive('ephemeral')).toBe('0m')
    expect(resolveModelKeepAlive('benchmark')).toBe('0m')
  })

  it('should respect custom lifecycle configuration overrides', () => {
    const custom = {
      pinnedKeepAlive: '1h',
      standardKeepAlive: '10m',
      ephemeralKeepAlive: '0s',
    }
    expect(resolveModelKeepAlive('primary_pinned', custom)).toBe('1h')
    expect(resolveModelKeepAlive('standard', custom)).toBe('10m')
    expect(resolveModelKeepAlive('ephemeral', custom)).toBe('0s')
  })

  it('should identify whether a model is loaded in VRAM based on exact tag or base model name', () => {
    const loadedList: RunningModelInfo[] = [
      {
        name: 'qwen2.5-coder:7b',
        model: 'qwen2.5-coder:7b',
        size: 4700000000,
        size_vram: 4700000000,
        expires_at: '2026-08-14T23:59:00Z',
      },
      {
        name: 'nomic-embed-text:latest',
        model: 'nomic-embed-text:latest',
        size: 500000000,
        size_vram: 500000000,
      },
    ]

    expect(isModelLoaded('qwen2.5-coder:7b', loadedList)).toBe(true)
    expect(isModelLoaded('qwen2.5-coder', loadedList)).toBe(true)
    expect(isModelLoaded('nomic-embed-text:latest', loadedList)).toBe(true)
    expect(isModelLoaded('nomic-embed-text', loadedList)).toBe(true)
    expect(isModelLoaded('deepseek-r1:8b', loadedList)).toBe(false)
    expect(isModelLoaded('', loadedList)).toBe(false)
    expect(isModelLoaded('qwen2.5-coder:7b', [])).toBe(false)
  })
})
