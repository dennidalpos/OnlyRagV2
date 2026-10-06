import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { safeAtomicWrite, pendingAtomicWritePathCount } from './safeAtomicFileWriter'

describe('safeAtomicFileWriter Unit Tests', () => {
  let testDir: string

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-atomic-write-test-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    try {
      fs.rmSync(testDir, { recursive: true, force: true })
    } catch {}
  })

  it('releases completed and failed paths without discarding a newer queued write', async () => {
    const before = pendingAtomicWritePathCount()
    const writes = Array.from({ length: 12 }, (_, index) => safeAtomicWrite(path.join(testDir, `unique-${index}.json`), '{}'))
    const samePath = path.join(testDir, 'serial.json')
    writes.push(...Array.from({ length: 6 }, (_, index) => safeAtomicWrite(samePath, String(index))))
    await Promise.all(writes)
    expect(fs.readFileSync(samePath, 'utf8')).toBe('5')
    const parent = path.join(testDir, 'blocked')
    fs.writeFileSync(parent, 'keep')
    await expect(safeAtomicWrite(path.join(parent, 'state.json'), '{}')).rejects.toThrow()
    expect(pendingAtomicWritePathCount()).toBe(before)
  })

  it.each(['EPERM', 'EBUSY', 'EACCES', 'EIO'])('preserves the acknowledged original after persistent %s rename failure', async (code) => {
    const target = path.join(testDir, 'retained.json')
    fs.writeFileSync(target, '{"retained":true}')
    const rename = vi.spyOn(fs.promises, 'rename').mockRejectedValue(Object.assign(new Error('Controlled rename refusal'), { code }))
    const copy = vi.spyOn(fs.promises, 'copyFile')
    await expect(safeAtomicWrite(target, '{"unsaved":true}')).rejects.toMatchObject({ code })
    expect(rename).toHaveBeenCalledTimes(code === 'EIO' ? 1 : 5)
    expect(copy).not.toHaveBeenCalled()
    expect(fs.readFileSync(target, 'utf8')).toBe('{"retained":true}')
    expect(fs.readdirSync(testDir)).toEqual(['retained.json'])
    rename.mockRestore()
    await expect(safeAtomicWrite(target, '{"retried":true}')).resolves.toBe(true)
    expect(fs.readFileSync(target, 'utf8')).toBe('{"retried":true}')
  })

  it('keeps the original when staging is interrupted after a partial write', async () => {
    const target = path.join(testDir, 'state.json')
    fs.writeFileSync(target, 'retained')
    vi.spyOn(fs.promises, 'writeFile').mockImplementationOnce(async (file) => {
      fs.writeFileSync(String(file), 'partial')
      throw Object.assign(new Error('Controlled staging interruption'), { code: 'EIO' })
    })
    await expect(safeAtomicWrite(target, 'replacement')).rejects.toMatchObject({ code: 'EIO' })
    expect(fs.readFileSync(target, 'utf8')).toBe('retained')
    expect(fs.readdirSync(testDir)).toEqual(['state.json'])
  })

  it('keeps bounded lock retries and commits after a transient refusal', async () => {
    const target = path.join(testDir, 'state.json')
    fs.writeFileSync(target, 'retained')
    const rename = vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(Object.assign(new Error('Controlled lock'), { code: 'EBUSY' }))
    await expect(safeAtomicWrite(target, 'replacement')).resolves.toBe(true)
    expect(rename).toHaveBeenCalledTimes(2)
    expect(fs.readFileSync(target, 'utf8')).toBe('replacement')
  })

  it('reports both replacement and staging cleanup failures while preserving the original', async () => {
    const target = path.join(testDir, 'state.json')
    fs.writeFileSync(target, 'retained')
    const replacementError = Object.assign(new Error('Controlled replacement refusal'), { code: 'EIO' })
    const cleanupError = Object.assign(new Error('Controlled cleanup refusal'), { code: 'EACCES' })
    vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(replacementError)
    vi.spyOn(fs.promises, 'unlink').mockRejectedValueOnce(cleanupError)
    await expect(safeAtomicWrite(target, 'replacement')).rejects.toMatchObject({ errors: [replacementError, cleanupError] })
    expect(fs.readFileSync(target, 'utf8')).toBe('retained')
    expect(pendingAtomicWritePathCount()).toBe(0)
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

  it('does not leave a rejected queue-cleanup promise after a write failure', async () => {
    const blockingParent = path.join(testDir, 'parent-file')
    fs.writeFileSync(blockingParent, 'not a directory', 'utf-8')
    const target = path.join(blockingParent, 'settings.json')

    await expect(safeAtomicWrite(target, 'content')).rejects.toMatchObject({
      code: expect.stringMatching(/^(EEXIST|ENOTDIR)$/),
    })
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
