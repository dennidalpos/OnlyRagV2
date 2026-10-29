import { describe, expect, it } from 'vitest'
import { isAllowedAppNavigation, isAllowedExternalUrl } from './navigationPolicy'

describe('isAllowedAppNavigation', () => {
  it('allows the packaged file renderer', () => {
    const index = 'file:///C:/Program%20Files/OnlyRag/index.html'
    expect(isAllowedAppNavigation(index, undefined, index)).toBe(true)
    expect(isAllowedAppNavigation('file:///C:/other/secrets.html', undefined, index)).toBe(false)
  })

  it('allows only the configured Vite development-server origin', () => {
    expect(isAllowedAppNavigation('http://127.0.0.1:5173/settings', 'http://127.0.0.1:5173')).toBe(true)
    expect(isAllowedAppNavigation('http://localhost:5173/', 'http://127.0.0.1:5173')).toBe(false)
  })

  it('rejects external, malformed, and production http navigation', () => {
    expect(isAllowedAppNavigation('https://example.test')).toBe(false)
    expect(isAllowedAppNavigation('not a url', 'http://127.0.0.1:5173')).toBe(false)
  })
})

describe('external URL policy', () => {
  it('accepts explicit web and mail protocols only', () => {
    expect(isAllowedExternalUrl('https://example.test/path')).toBe(true)
    expect(isAllowedExternalUrl('mailto:help@example.test')).toBe(true)
    expect(isAllowedExternalUrl('https://user:pass@example.test')).toBe(false)
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedExternalUrl('https://example.test@evil.test')).toBe(false)
  })
})
