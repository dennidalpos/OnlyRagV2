import { describe, it, expect } from 'vitest'
import {
  normalizeToolId,
  resolveInstallTarget,
  buildInstallCommand,
  extractVersion,
  formatToolchainInventory,
  DEV_TOOL_ALLOWLIST,
} from './devToolchain'

describe('devToolchain — allow-list policy', () => {
  it('should accept allow-listed tools and their common aliases', () => {
    expect(normalizeToolId('node')).toBe('node')
    expect(normalizeToolId('NodeJS')).toBe('node')
    expect(normalizeToolId('python3')).toBe('python')
    expect(normalizeToolId(' Git ')).toBe('git')
  })

  it('should refuse anything outside the allow-list, including plausible package names', () => {
    expect(normalizeToolId('docker')).toBeNull()
    expect(normalizeToolId('curl')).toBeNull()
    expect(normalizeToolId('rm -rf /')).toBeNull()
    expect(normalizeToolId('')).toBeNull()
    expect(buildInstallCommand('docker')).toBeNull()
  })

  it('should install Node.js when npm is requested, since npm ships with it', () => {
    expect(resolveInstallTarget('npm')?.id).toBe('node')
    expect(buildInstallCommand('npm')).toContain('OpenJS.NodeJS.LTS')
  })

  it('should build a fully non-interactive winget command, so the shell session cannot hang on a prompt', () => {
    const cmd = buildInstallCommand('git')!
    expect(cmd).toContain('winget install')
    expect(cmd).toContain('--id Git.Git')
    expect(cmd).toContain('--silent')
    expect(cmd).toContain('--accept-package-agreements')
    expect(cmd).toContain('--accept-source-agreements')
  })

  it('should give every allow-listed tool either a package id or a provider', () => {
    for (const tool of DEV_TOOL_ALLOWLIST) {
      expect(Boolean(tool.wingetId) || Boolean(tool.providedBy)).toBe(true)
    }
  })
})

describe('devToolchain — probing and reporting', () => {
  it('should extract the version number from each tool\'s own output format', () => {
    expect(extractVersion('v20.11.1')).toBe('20.11.1')
    expect(extractVersion('git version 2.43.0.windows.1')).toBe('2.43.0')
    expect(extractVersion('Python 3.12.2')).toBe('3.12.2')
    expect(extractVersion('')).toBe('')
  })

  it('should format an inventory that names missing tools explicitly and shows how to fix them', () => {
    const inventory = formatToolchainInventory([
      { id: 'node', displayName: 'Node.js', installed: true, version: '20.11.1' },
      { id: 'git', displayName: 'Git', installed: false },
    ])

    expect(inventory).toContain('- node: OK (20.11.1)')
    expect(inventory).toContain('- git: MISSING')
    expect(inventory).toContain('Missing tools: git')
    expect(inventory).toContain('"tool": "ensure_tool"')
  })

  it('should state plainly when nothing is missing', () => {
    const inventory = formatToolchainInventory([
      { id: 'node', displayName: 'Node.js', installed: true, version: '20.11.1' },
    ])
    expect(inventory).toContain('All probed development tools are available.')
    expect(inventory).not.toContain('MISSING')
  })
})
