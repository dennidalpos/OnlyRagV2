import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { documentIoRepository } from './documentIoRepository'

describe('DocumentIoRepository — atomic writes', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-doc-io-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writeText writes the content and leaves no leftover .tmp-* sibling file', () => {
    const targetPath = path.join(tmpDir, 'export.md')
    const res = documentIoRepository.writeText(targetPath, '# Hello World')

    expect(res.success).toBe(true)
    expect(fs.readFileSync(targetPath, 'utf-8')).toBe('# Hello World')
    const leftovers = fs.readdirSync(tmpDir).filter((f) => f.includes('.tmp-'))
    expect(leftovers).toEqual([])
  })

  it('writeBuffer writes the buffer and leaves no leftover .tmp-* sibling file', () => {
    const targetPath = path.join(tmpDir, 'export.pdf')
    const buffer = Buffer.from([0x25, 0x50, 0x44, 0x46])
    const res = documentIoRepository.writeBuffer(targetPath, buffer)

    expect(res.success).toBe(true)
    expect(fs.readFileSync(targetPath)).toEqual(buffer)
    const leftovers = fs.readdirSync(tmpDir).filter((f) => f.includes('.tmp-'))
    expect(leftovers).toEqual([])
  })

  it('writeText fails cleanly (no stray tmp file, no partial target) when the destination directory does not exist', () => {
    const targetPath = path.join(tmpDir, 'missing-subdir', 'export.md')
    const res = documentIoRepository.writeText(targetPath, 'content')

    expect(res.success).toBe(false)
    expect(res.error).toBeTruthy()
    expect(fs.existsSync(targetPath)).toBe(false)
    const leftovers = fs.readdirSync(tmpDir)
    expect(leftovers).toEqual([])
  })

  it('an existing target is only replaced after the write fully succeeds', () => {
    const targetPath = path.join(tmpDir, 'export.md')
    documentIoRepository.writeText(targetPath, 'original content')

    const res = documentIoRepository.writeText(targetPath, 'updated content')

    expect(res.success).toBe(true)
    expect(fs.readFileSync(targetPath, 'utf-8')).toBe('updated content')
  })
})
