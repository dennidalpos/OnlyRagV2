import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { workspaceAppService } from './workspaceAppService'

describe('WorkspaceAppService File Deletion & Reference Purge Unit Tests', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-delete-test-'))
  })

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('should successfully delete a single file on disk and return success', async () => {
    const filePath = path.join(tmpDir, 'test-file.txt')
    fs.writeFileSync(filePath, 'hello world', 'utf-8')
    expect(fs.existsSync(filePath)).toBe(true)

    const res = await workspaceAppService.deleteFile(filePath)
    expect(res.success).toBe(true)
    expect(fs.existsSync(filePath)).toBe(false)
  })

  it('should recursively delete a directory on disk', async () => {
    const subDir = path.join(tmpDir, 'subfolder')
    const childFile = path.join(subDir, 'child.txt')
    fs.mkdirSync(subDir, { recursive: true })
    fs.writeFileSync(childFile, 'child content', 'utf-8')

    expect(fs.existsSync(childFile)).toBe(true)
    const res = await workspaceAppService.deleteFile(subDir)
    expect(res.success).toBe(true)
    expect(fs.existsSync(subDir)).toBe(false)
  })

  it('should return failure if trying to delete a non-existent file', async () => {
    const missingPath = path.join(tmpDir, 'non-existent.txt')
    const res = await workspaceAppService.deleteFile(missingPath)
    expect(res.success).toBe(false)
    expect(res.error).toBe('File does not exist')
  })
})
