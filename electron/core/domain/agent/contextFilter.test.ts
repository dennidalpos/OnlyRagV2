import { describe, it, expect } from 'vitest'
import { isIgnoredPath, isSecretFile, validatePathSafety, matchesIgnorePatterns } from './contextFilter'

describe('contextFilter domain logic & AppSec protection', () => {
  it('should ignore standard hidden & build directories', () => {
    expect(isIgnoredPath('node_modules', true)).toBe(true)
    expect(isIgnoredPath('.git', true)).toBe(true)
    expect(isIgnoredPath('dist', true)).toBe(true)
    expect(isIgnoredPath('.venv', true)).toBe(true)
    expect(isIgnoredPath('src', true)).toBe(false)
  })

  it('should ignore binary files, lockfiles, and secrets', () => {
    expect(isIgnoredPath('image.png', false)).toBe(true)
    expect(isIgnoredPath('binary.dll', false)).toBe(true)
    expect(isIgnoredPath('package-lock.json', false)).toBe(true)
    expect(isIgnoredPath('.env', false)).toBe(true)
    expect(isIgnoredPath('.env.local', false)).toBe(true)
    expect(isIgnoredPath('id_rsa', false)).toBe(true)
    expect(isIgnoredPath('secret.pem', false)).toBe(true)
    expect(isIgnoredPath('App.tsx', false)).toBe(false)
    expect(isIgnoredPath('main.py', false)).toBe(false)
  })

  it('should identify secret and credential files correctly', () => {
    expect(isSecretFile('.env')).toBe(true)
    expect(isSecretFile('.env.production')).toBe(true)
    expect(isSecretFile('id_rsa')).toBe(true)
    expect(isSecretFile('server.key')).toBe(true)
    expect(isSecretFile('cert.pem')).toBe(true)
    expect(isSecretFile('index.ts')).toBe(false)
  })

  it('should prevent Directory Traversal outside workspace root', () => {
    const root = 'D:/GITHUB/OnlyRagV2'
    
    // Inside workspace -> allowed
    const valid = validatePathSafety('D:/GITHUB/OnlyRagV2/src/App.tsx', root)
    expect(valid.safePath).not.toBeNull()

    // Outside workspace -> blocked
    const traversal = validatePathSafety('D:/GITHUB/other-folder/secret.txt', root)
    expect(traversal.safePath).toBeNull()
    expect(traversal.error).toContain('Directory Traversal Blocked')
  })

  it('should block access to credential files via validatePathSafety', () => {
    const root = 'D:/GITHUB/OnlyRagV2'
    const envFile = validatePathSafety('D:/GITHUB/OnlyRagV2/.env', root)
    expect(envFile.safePath).toBeNull()
    expect(envFile.error).toContain('contains sensitive credentials/secrets')
  })

  it('should match gitignore relative patterns', () => {
    const patterns = ['dist/', 'coverage', '*.log']
    expect(matchesIgnorePatterns('dist/main.js', patterns)).toBe(true)
    expect(matchesIgnorePatterns('coverage/lcov.info', patterns)).toBe(true)
    expect(matchesIgnorePatterns('src/App.tsx', patterns)).toBe(false)
  })
})
