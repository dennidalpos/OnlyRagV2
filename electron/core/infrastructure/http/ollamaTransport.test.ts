import { describe, expect, it } from 'vitest'
import { resolveOllamaUrl } from './ollamaTransport'

describe('resolveOllamaUrl', () => {
  it('keeps https hosts on https (the agent stream path used to force plain http)', () => {
    expect(resolveOllamaUrl('/api/chat', 'https://ollama.example.com')).toEqual({
      protocol: 'https:',
      hostname: 'ollama.example.com',
      port: 443,
      path: '/api/chat',
    })
  })

  it('defaults bare hosts to http on the Ollama port', () => {
    expect(resolveOllamaUrl('/api/generate', '192.168.1.20')).toEqual({
      protocol: 'http:',
      hostname: '192.168.1.20',
      port: 11434,
      path: '/api/generate',
    })
  })

  it('falls back to the local default for a blank host', () => {
    expect(resolveOllamaUrl('/api/tags', '')).toMatchObject({ protocol: 'http:', hostname: '127.0.0.1', port: '11434' })
  })
})
