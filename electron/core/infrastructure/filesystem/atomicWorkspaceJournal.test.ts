import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { AtomicWorkspaceJournal } from './atomicWorkspaceJournal'

describe('AtomicWorkspaceJournal Unit Tests', () => {
  let tempDir: string
  let journal: AtomicWorkspaceJournal

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-journal-test-'))
    journal = new AtomicWorkspaceJournal()
  })

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('should snapshot existing file and restore original content on rollback', () => {
    const filePath = path.join(tempDir, 'existing.txt')
    fs.writeFileSync(filePath, 'INITIAL CONTENT', 'utf-8')

    journal.recordBeforeModification(filePath)

    // Modify file
    fs.writeFileSync(filePath, 'CORRUPTED CONTENT', 'utf-8')
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('CORRUPTED CONTENT')

    const rollbackRes = journal.rollbackAll()
    expect(rollbackRes.restoredCount).toBe(1)
    expect(rollbackRes.errors).toHaveLength(0)
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('INITIAL CONTENT')
  })

  it('should remove newly created files upon rollback', () => {
    const newFilePath = path.join(tempDir, 'new_file.txt')
    expect(fs.existsSync(newFilePath)).toBe(false)

    journal.recordBeforeModification(newFilePath)

    // Create file
    fs.writeFileSync(newFilePath, 'NEW DATA', 'utf-8')
    expect(fs.existsSync(newFilePath)).toBe(true)

    const rollbackRes = journal.rollbackAll()
    expect(rollbackRes.restoredCount).toBe(1)
    expect(fs.existsSync(newFilePath)).toBe(false)
  })

  it('should preserve baseline initial state even across multiple modifications', () => {
    const filePath = path.join(tempDir, 'multi_edit.txt')
    fs.writeFileSync(filePath, 'V1', 'utf-8')

    journal.recordBeforeModification(filePath)
    fs.writeFileSync(filePath, 'V2', 'utf-8')

    journal.recordBeforeModification(filePath)
    fs.writeFileSync(filePath, 'V3', 'utf-8')

    journal.rollbackAll()
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('V1')
  })

  it('should commit changes and clear journal', () => {
    const filePath = path.join(tempDir, 'committed.txt')
    fs.writeFileSync(filePath, 'V1', 'utf-8')

    journal.recordBeforeModification(filePath)
    fs.writeFileSync(filePath, 'V2', 'utf-8')

    const count = journal.commit()
    expect(count).toBe(1)
    expect(journal.trackedCount).toBe(0)
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('V2')
  })

  it('should safely handle directory targets without throwing EISDIR and remove new directory on rollback', () => {
    const subDir = path.join(tempDir, 'new_sub_dir')
    journal.recordBeforeModification(subDir)

    fs.mkdirSync(subDir, { recursive: true })
    fs.writeFileSync(path.join(subDir, 'sub_file.txt'), 'content', 'utf-8')
    expect(fs.existsSync(subDir)).toBe(true)

    const rollbackRes = journal.rollbackAll()
    expect(rollbackRes.restoredCount).toBe(1)
    expect(fs.existsSync(subDir)).toBe(false)
  })
})
