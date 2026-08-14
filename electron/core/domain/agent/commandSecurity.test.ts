import { describe, it, expect } from 'vitest'
import { checkCommandSecurity } from './commandSecurity'

describe('commandSecurity Domain Unit Tests', () => {
  it('should block destructive git reset --hard commands', () => {
    const res = checkCommandSecurity('git reset --hard HEAD')
    expect(res.isAllowed).toBe(false)
    expect(res.blockedReason).toContain('Destructive command pattern detected')
  })

  it('should block destructive git clean -fd commands', () => {
    const res = checkCommandSecurity('git clean -fd')
    expect(res.isAllowed).toBe(false)
  })

  it('should block force push commands', () => {
    const res = checkCommandSecurity('git push origin main --force')
    expect(res.isAllowed).toBe(false)
  })

  it('should block broad root deletion commands', () => {
    const res = checkCommandSecurity('rm -rf /')
    expect(res.isAllowed).toBe(false)

    const res2 = checkCommandSecurity('rm -rf .')
    expect(res2.isAllowed).toBe(false)
  })

  it('should translate harmless Unix commands to PowerShell equivalents', () => {
    const res1 = checkCommandSecurity('rm -rf node_modules')
    expect(res1.isAllowed).toBe(true)
    expect(res1.sanitizedCommand).toBe('Remove-Item -Recurse -Force "node_modules"')

    const res2 = checkCommandSecurity('touch src/newFile.ts')
    expect(res2.isAllowed).toBe(true)
    expect(res2.sanitizedCommand).toContain('New-Item -ItemType File')

    const res3 = checkCommandSecurity('ls -la')
    expect(res3.isAllowed).toBe(true)
    expect(res3.sanitizedCommand).toBe('Get-ChildItem')
  })

  it('should allow normal commands like npm run typecheck or vitest', () => {
    const res = checkCommandSecurity('npm run typecheck')
    expect(res.isAllowed).toBe(true)
    expect(res.sanitizedCommand).toBe('npm run typecheck')
  })
})
