import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { isIgnoredPath, isSecretFile, validatePathSafety, isProtectedSystemDirectory } from './contextFilter'

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
    const root = process.cwd()
    
    // Inside workspace -> allowed
    const valid = validatePathSafety('src/App.tsx', root)
    expect(valid.safePath).not.toBeNull()

    // Relative path inside workspace -> resolved relative to workspaceRoot and allowed
    const validRelative = validatePathSafety('src/App.tsx', root)
    expect(validRelative.safePath).not.toBeNull()
    expect(validRelative.safePath?.replace(/\\/g, '/')).toContain('/src/App.tsx')

    // Relative path with quotes
    const testDir = path.resolve(root, 'test_app')
    const validQuoted = validatePathSafety('"project-dashboard-task/index.html"', testDir)
    expect(validQuoted.safePath).not.toBeNull()
    expect(validQuoted.safePath?.replace(/\\/g, '/')).toContain('test_app/project-dashboard-task/index.html')

    // Shell command chaining artifact stripping
    const rawCmd = 'Project Dashboard Task; cd Project Dashboard Task; npx vite --template project --workspace DashboardTask --mode dev'
    const validChained = validatePathSafety(rawCmd, testDir)
    expect(validChained.safePath).not.toBeNull()
    expect(validChained.safePath?.replace(/\\/g, '/')).toContain('test_app/Project-Dashboard-Task')

    // Outside workspace -> blocked
    const traversal = validatePathSafety(path.resolve(root, '../other-folder/secret.txt'), root)
    expect(traversal.safePath).toBeNull()
    expect(traversal.error).toContain('Directory Traversal Blocked')

    // Relative traversal escaping workspace -> blocked
    const relativeEscape = validatePathSafety('../../other-folder/secret.txt', root)
    expect(relativeEscape.safePath).toBeNull()
    expect(relativeEscape.error).toContain('Directory Traversal Blocked')

    // Explicit absolute user directories outside workspace are allowed when no workspaceRoot constraint is given (e.g. Standalone exploration)
    const userDocPath = validatePathSafety('C:\\Users\\Utente\\Il mio Drive\\document.pdf', null)
    expect(userDocPath.safePath).not.toBeNull()
    expect(userDocPath.error).toBeUndefined()
  })

  it('should block access to credential files via validatePathSafety', () => {
    const root = process.cwd()
    const envFile = validatePathSafety(path.resolve(root, '.env'), root)
    expect(envFile.safePath).toBeNull()
    expect(envFile.error).toContain('contains sensitive credentials/secrets')
  })

  it('should identify and block protected system directories (Program Files / Windows)', () => {
    expect(isProtectedSystemDirectory('C:\\Program Files\\OnlyRag V2')).toBe(true)
    expect(isProtectedSystemDirectory('C:\\Windows\\System32')).toBe(true)
    expect(isProtectedSystemDirectory('C:\\Users\\Utente\\Desktop\\test_app')).toBe(false)

    const sysPath = validatePathSafety('package.json', 'C:\\Program Files\\OnlyRag V2')
    expect(sysPath.safePath).toBeNull()
    expect(sysPath.error).toContain('protected system directory')
  })
})
