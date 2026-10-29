import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { gitCliRepository } from './gitCliRepository'

describe('GitCliRepository Unit Tests', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-git-test-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup error
    }
  })

  it('should detect non-git repository correctly', () => {
    const res = gitCliRepository.getStatusAndDiff(tempDir)
    expect(res.isGitRepo).toBe(false)
    expect(res.statusLines).toEqual([])
  })

  it('should initialize git repository and detect changes including untracked files', () => {
    const initRes = gitCliRepository.init(tempDir)
    expect(initRes.success).toBe(true)

    // Initially clean
    const emptyStatus = gitCliRepository.getStatusAndDiff(tempDir)
    expect(emptyStatus.isGitRepo).toBe(true)
    expect(emptyStatus.statusLines).toEqual([])
    expect(emptyStatus.diffText).toBe('')

    // Create a new untracked file
    const testFilePath = path.join(tempDir, 'hello.txt')
    fs.writeFileSync(testFilePath, 'Hello World\nLine 2\n', 'utf-8')

    const resWithUntracked = gitCliRepository.getStatusAndDiff(tempDir)
    expect(resWithUntracked.isGitRepo).toBe(true)
    expect(resWithUntracked.statusLines.some((l) => l.includes('hello.txt'))).toBe(true)
    expect(resWithUntracked.diffText).toContain('Hello World')
  })

  it('previews staged and untracked changes together for Full access commits', () => {
    gitCliRepository.init(tempDir)
    fs.writeFileSync(path.join(tempDir, 'staged.txt'), 'staged')
    fs.writeFileSync(path.join(tempDir, 'untracked.txt'), 'untracked')
    execFileSync('git', ['add', '--', 'staged.txt'], { cwd: tempDir })

    const preview = gitCliRepository.previewAllCommit(tempDir)
    expect(preview.paths).toEqual(['staged.txt', 'untracked.txt'])
    expect(preview.diffText).toContain('staged')
    expect(preview.diffText).toContain('untracked')
  })
})
