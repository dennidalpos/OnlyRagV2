import { describe, expect, it } from 'vitest'
import { isRemoteOllamaMode } from './ollamaConnectionMode'

describe('isRemoteOllamaMode', () => {
  it('honors the explicit connection mode', () => {
    expect(isRemoteOllamaMode({ ollamaMode: 'remote', ollamaHost: 'http://127.0.0.1:11434' })).toBe(true)
    expect(isRemoteOllamaMode({ ollamaMode: 'local', ollamaHost: 'http://ai-server:11434' })).toBe(false)
  })

  it('infers legacy settings from the configured host', () => {
    expect(isRemoteOllamaMode({ ollamaHost: 'http://ai-server:11434' })).toBe(true)
    expect(isRemoteOllamaMode({ ollamaHost: 'http://localhost:11434' })).toBe(false)
  })
})
