import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
    vi.restoreAllMocks()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it.each(['Unicode città 漢 😀', Buffer.from([0, 1, 255])])('creates and reads back a new export without replacing prior files', (content) => {
    const target = path.join(tmpDir, 'new-export')
    expect(documentIoRepository.createExportFile(target, content).success).toBe(true)
    expect(fs.readFileSync(target)).toEqual(Buffer.from(content))
    expect(documentIoRepository.createExportFile(target, 'Replacement')).toMatchObject({ success: false, collision: true })
    expect(fs.readFileSync(target)).toEqual(Buffer.from(content))
  })

  it.each(['write', 'flush'] as const)('closes the descriptor and removes only its partial export after a %s failure', (failure) => {
    const retained = path.join(tmpDir, 'retained.md')
    fs.writeFileSync(retained, 'Preserve')
    const target = path.join(tmpDir, 'failed.md')
    const nativeWrite = fs.writeFileSync
    let descriptor!: number
    vi.spyOn(fs, 'writeFileSync').mockImplementation((file, data, options) => {
      descriptor = file as number
      nativeWrite(file, data, options)
      if (failure === 'write') throw new Error('Disk full after partial write')
    })
    if (failure === 'flush')
      vi.spyOn(fs, 'fsyncSync').mockImplementation(() => {
        throw new Error('Flush refused')
      })
    expect(documentIoRepository.createExportFile(target, 'Partial')).toMatchObject({ success: false, collision: false })
    expect(() => fs.fstatSync(descriptor)).toThrow()
    expect(fs.existsSync(target)).toBe(false)
    expect(fs.readFileSync(retained, 'utf8')).toBe('Preserve')
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
