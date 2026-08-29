import { describe, expect, it } from 'vitest'
import { isAllowedAppNavigation } from './navigationPolicy'

describe('isAllowedAppNavigation', () => {
  it('allows the packaged file renderer', () => {
    expect(isAllowedAppNavigation('file:///C:/Program%20Files/OnlyRag/index.html')).toBe(true)
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
