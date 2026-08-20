import { describe, it, expect } from 'vitest'
import { getNonInteractiveEnv, sanitizePowerShellCommand, detectInteractivePrompt } from './shellStreamGuard'

describe('shellStreamGuard', () => {
  it('should inject mandatory non-interactive env variables', () => {
    const baseEnv = { PATH: '/usr/bin' }
    const guardedEnv = getNonInteractiveEnv(baseEnv)

    expect(guardedEnv.CI).toBe('true')
    expect(guardedEnv.PAGER).toBe('cat')
    expect(guardedEnv.NPM_CONFIG_YES).toBe('true')
    expect(guardedEnv.PIP_NO_INPUT).toBe('1')
    expect(guardedEnv.DEBIAN_FRONTEND).toBe('noninteractive')
    expect(guardedEnv.PATH).toBe('/usr/bin')
  })

  it('should sanitize bash brace expansion and unix flags for PowerShell execution', () => {
    const rawCmd = 'mkdir -p src/{package.json, index.html}'
    const sanitized = sanitizePowerShellCommand(rawCmd)

    expect(sanitized).toBe('New-Item -ItemType Directory -Force -Path "src/package.json", "src/index.html"')
  })

  it('should sanitize touch and cd chained commands for PowerShell', () => {
    const rawCmd = 'cd src && touch App.tsx'
    const sanitized = sanitizePowerShellCommand(rawCmd)

    expect(sanitized).toBe('Set-Location "src"; New-Item -ItemType File -Force -Path "App.tsx"')
  })

  it('should detect common interactive-prompt patterns in shell output', () => {
    expect(detectInteractivePrompt('Overwrite existing file? [y/n]')).not.toBeNull()
    expect(detectInteractivePrompt('Enter password: ')).not.toBeNull()
    expect(detectInteractivePrompt('Do you want to continue? [Y/n]: ')).not.toBeNull()
    expect(detectInteractivePrompt('Building project...\n42 modules transformed.')).toBeNull()
  })
})
