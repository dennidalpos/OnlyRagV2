import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { safeAtomicWrite } from './safeAtomicFileWriter'

describe('safeAtomicFileWriter Unit Tests', () => {
  let testDir: string

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-atomic-write-test-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true })
    } catch {}
  })

  it('writes content atomically to a file', async () => {
    const target = path.join(testDir, 'config.json')
    const content = JSON.stringify({ hello: 'world' }, null, 2)

    const success = await safeAtomicWrite(target, content)
    expect(success).toBe(true)
    expect(fs.existsSync(target)).toBe(true)
    expect(fs.readFileSync(target, 'utf-8')).toBe(content)
  })

  it('creates parent directory if it does not exist', async () => {
    const target = path.join(testDir, 'nested', 'deep', 'settings.json')
    const content = 'deep content'

    const success = await safeAtomicWrite(target, content)
    expect(success).toBe(true)
    expect(fs.existsSync(target)).toBe(true)
    expect(fs.readFileSync(target, 'utf-8')).toBe(content)
  })

  it('handles multiple concurrent writes to the same destination sequentially without corruption', async () => {
    const target = path.join(testDir, 'concurrent.txt')
    const writes = Array.from({ length: 10 }, (_, i) => safeAtomicWrite(target, `content-${i}`))

    const results = await Promise.all(writes)
    expect(results.every((r) => r === true)).toBe(true)
    expect(fs.existsSync(target)).toBe(true)
    // File content should be the last resolved string
    const finalContent = fs.readFileSync(target, 'utf-8')
    expect(finalContent).toMatch(/^content-\d$/)
  })
})
