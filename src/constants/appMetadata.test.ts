import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { APP_AUTHOR, APP_REPOSITORY_SLUG, APP_REPOSITORY_URL, APP_VERSION } from './appMetadata'

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))

describe('appMetadata', () => {
  it('should expose the real package version rather than the fallback', () => {
    expect(APP_VERSION).toBe(pkg.version)
    expect(APP_VERSION).not.toBe('0.0.0')
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('should expose the author name without the embedded URL', () => {
    expect(APP_AUTHOR.length).toBeGreaterThan(0)
    expect(APP_AUTHOR).not.toContain('<')
    expect(APP_AUTHOR).not.toContain('http')
    expect(String(pkg.author)).toContain(APP_AUTHOR)
  })

  it('should derive a browsable repository URL and a compact owner/repo slug', () => {
    expect(APP_REPOSITORY_URL).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+$/)
    expect(APP_REPOSITORY_SLUG).toMatch(/^[^/]+\/[^/]+$/)
    expect(APP_REPOSITORY_URL.endsWith(APP_REPOSITORY_SLUG)).toBe(true)
  })
})
