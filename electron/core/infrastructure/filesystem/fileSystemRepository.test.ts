import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { FileSystemRepository } from './fileSystemRepository'

describe('FileSystemRepository Unit Tests', () => {
  const repo = new FileSystemRepository()
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-test-repo-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('should write and read whole file content', async () => {
    const testFile = path.join(tempDir, 'test.txt')
    const writeRes = await repo.writeFile(testFile, 'line1\nline2\nline3\nline4\nline5')
    expect(writeRes.success).toBe(true)

    const readRes = await repo.readFile(testFile)
    expect(readRes.success).toBe(true)
    expect(readRes.content).toBe('line1\nline2\nline3\nline4\nline5')
    expect(readRes.totalLines).toBe(5)
  })

  it('should slice file content with line numbers when startLine and endLine are provided', async () => {
    const testFile = path.join(tempDir, 'slice.txt')
    await repo.writeFile(testFile, 'alpha\nbeta\ngamma\ndelta\nepsilon')

    const readSlice = await repo.readFile(testFile, 2, 4)
    expect(readSlice.success).toBe(true)
    expect(readSlice.startLine).toBe(2)
    expect(readSlice.endLine).toBe(4)
    expect(readSlice.totalLines).toBe(5)
    expect(readSlice.content).toContain('2: beta')
    expect(readSlice.content).toContain('3: gamma')
    expect(readSlice.content).toContain('4: delta')
    expect(readSlice.content).not.toContain('1: alpha')
  })

  it('should delete a file successfully', async () => {
    const testFile = path.join(tempDir, 'to_delete.txt')
    await repo.writeFile(testFile, 'delete me')
    expect(fs.existsSync(testFile)).toBe(true)

    const delRes = await repo.deleteFile(testFile)
    expect(delRes.success).toBe(true)
    expect(fs.existsSync(testFile)).toBe(false)
  })

  it('should replace single chunk and multiple chunks with CRLF normalization tolerance', async () => {
    const testFile = path.join(tempDir, 'multi.ts')
    await repo.writeFile(testFile, 'const a = 1;\r\nconst b = 2;\r\nconst c = 3;')

    const multiRes = await repo.multiReplaceChunks(testFile, [
      { targetContent: 'const a = 1;', replacementContent: 'const a = 100;' },
      { targetContent: 'const c = 3;', replacementContent: 'const c = 300;' },
    ])

    expect(multiRes.success).toBe(true)
    expect(multiRes.replacedCount).toBe(2)

    const readUpdated = await repo.readFile(testFile)
    expect(readUpdated.content).toContain('const a = 100;')
    expect(readUpdated.content).toContain('const b = 2;')
    expect(readUpdated.content).toContain('const c = 300;')

    // Verify CRLF line endings were preserved
    const rawDisk = fs.readFileSync(testFile, 'utf-8')
    expect(rawDisk).toContain('\r\n')
  })
})
