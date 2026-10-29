import { describe, expect, it } from 'vitest'
import { noConfiguredModelMessage, resolveConfiguredModel } from './configuredModel'

describe('resolveConfiguredModel', () => {
  it('prefers the explicit choice, then the role setting, then the default model', () => {
    const settings = { defaultModel: 'default:1b', chatModel: 'chat:1b', codingModel: ' ', translationModel: '' }

    expect(resolveConfiguredModel('chat', settings, 'picked:7b')).toBe('picked:7b')
    expect(resolveConfiguredModel('chat', settings)).toBe('chat:1b')
    expect(resolveConfiguredModel('coding', settings)).toBe('default:1b')
    expect(resolveConfiguredModel('translation', settings, '  ')).toBe('default:1b')
  })

  it('returns no model instead of guessing one that may not be installed', () => {
    expect(resolveConfiguredModel('coding', { defaultModel: '' })).toBe('')
    expect(resolveConfiguredModel('chat', undefined)).toBe('')
    expect(noConfiguredModelMessage('coding')).toMatch(/No coding model is configured/)
  })
})
