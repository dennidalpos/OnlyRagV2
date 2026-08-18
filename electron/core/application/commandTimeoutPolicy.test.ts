import { describe, it, expect } from 'vitest'
import { __testing } from './agentToolExecutorService'

const { resolveCommandTimeoutMs, isLongRunningCommand } = __testing

describe('run_command timeout policy', () => {
  it('should give installs and scaffolding a long ceiling instead of the old fixed 60s', () => {
    expect(isLongRunningCommand('npm install')).toBe(true)
    expect(isLongRunningCommand('pnpm add react')).toBe(true)
    expect(isLongRunningCommand('pip install fastapi')).toBe(true)
    expect(isLongRunningCommand('npx create-vite@latest .')).toBe(true)
    expect(isLongRunningCommand('git clone https://example.com/repo.git')).toBe(true)

    expect(resolveCommandTimeoutMs('npm install')).toBe(600000)
    expect(resolveCommandTimeoutMs('npm install')).toBeGreaterThan(resolveCommandTimeoutMs('npm run lint'))
  })

  it('should keep ordinary commands on the default ceiling', () => {
    expect(isLongRunningCommand('git status')).toBe(false)
    expect(isLongRunningCommand('npm run build')).toBe(false)
    expect(resolveCommandTimeoutMs('git status')).toBe(120000)
  })

  it('should honour an explicit override, clamped to sane bounds', () => {
    expect(resolveCommandTimeoutMs('npm run build', 30)).toBe(30000)
    expect(resolveCommandTimeoutMs('npm run build', 99999)).toBe(900000)
    expect(resolveCommandTimeoutMs('npm run build', 1)).toBe(5000)
    expect(resolveCommandTimeoutMs('npm run build', 'not-a-number')).toBe(120000)
    expect(resolveCommandTimeoutMs('npm run build', -5)).toBe(120000)
  })
})
