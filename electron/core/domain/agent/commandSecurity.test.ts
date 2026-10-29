import { describe, it, expect } from 'vitest'
import { checkCommandSecurity } from './commandSecurity'

describe('commandSecurity Domain Unit Tests', () => {
  const workspace = 'C:\\workspace'

  it('blocks destructive git commands', () => {
    const res = checkCommandSecurity('git reset --hard HEAD')
    expect(res.isAllowed).toBe(false)
    expect(res.blockedReason).toContain('Destructive command pattern detected')
  })

  it('blocks destructive git clean and force push commands', () => {
    const clean = checkCommandSecurity('git clean -fd')
    const push = checkCommandSecurity('git push origin main --force')
    expect(clean.isAllowed).toBe(false)
    expect(push.isAllowed).toBe(false)
  })

  it('should block broad root deletion commands', () => {
    const res = checkCommandSecurity('rm -rf /', workspace)
    expect(res.isAllowed).toBe(false)

    const res2 = checkCommandSecurity('rm -rf .', workspace)
    expect(res2.isAllowed).toBe(false)
  })

  it('blocks destructive git restore and checkout commands', () => {
    const res1 = checkCommandSecurity('git restore .')
    expect(res1.isAllowed).toBe(false)

    const res2 = checkCommandSecurity('git checkout -- .')
    expect(res2.isAllowed).toBe(false)
  })

  it('should translate harmless Unix commands to PowerShell equivalents', () => {
    const res1 = checkCommandSecurity('rm -rf node_modules', workspace)
    expect(res1).toMatchObject({ isAllowed: true, requiresApproval: true })
    expect(res1.sanitizedCommand).toBe('Remove-Item -Recurse -Force "node_modules"')

    const res2 = checkCommandSecurity('touch src/newFile.ts', workspace)
    expect(res2).toMatchObject({ isAllowed: true, requiresApproval: true })
    expect(res2.sanitizedCommand).toContain('New-Item -ItemType File')

    const res3 = checkCommandSecurity('ls -la')
    expect(res3.isAllowed).toBe(true)
    expect(res3.sanitizedCommand).toBe('Get-ChildItem')

    // Creating a directory inside the workspace cannot lose data, so it runs without approval.
    const res4 = checkCommandSecurity('mkdir -p src/components/test', workspace)
    expect(res4).toMatchObject({ isAllowed: true, requiresApproval: false })
    expect(res4.sanitizedCommand).toBe('New-Item -ItemType Directory -Force -Path "src/components/test"')
  })

  it('should allow normal commands like npm run typecheck or vitest', () => {
    const res = checkCommandSecurity('npm run typecheck')
    expect(res.isAllowed).toBe(true)
    expect(res.sanitizedCommand).toBe('npm run typecheck')
  })
})
