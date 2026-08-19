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

  it('rollbackLastStep should undo only the most recently ended step, leaving earlier steps intact', () => {
    const filePath = path.join(tempDir, 'stepped.txt')
    fs.writeFileSync(filePath, 'V1', 'utf-8')

    // Step 1: V1 -> V2
    journal.recordBeforeModification(filePath)
    fs.writeFileSync(filePath, 'V2', 'utf-8')
    journal.endStep()

    // Step 2: V2 -> V3
    journal.recordBeforeModification(filePath)
    fs.writeFileSync(filePath, 'V3', 'utf-8')
    journal.endStep()

    expect(journal.canRollbackLastStep).toBe(true)
    const res = journal.rollbackLastStep()
    expect(res.restoredCount).toBe(1)
    expect(res.errors).toHaveLength(0)
    // Undid step 2 only: back to V2, not the session-start V1.
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('V2')
  })

  it('rollbackLastStep should be a no-op when the last ended step touched no files', () => {
    journal.endStep() // no recordBeforeModification calls before this
    expect(journal.canRollbackLastStep).toBe(false)
    const res = journal.rollbackLastStep()
    expect(res).toEqual({ restoredCount: 0, errors: [] })
  })

  it('rollbackLastStep should be a no-op when called twice without an intervening endStep()', () => {
    const filePath = path.join(tempDir, 'once.txt')
    fs.writeFileSync(filePath, 'V1', 'utf-8')
    journal.recordBeforeModification(filePath)
    fs.writeFileSync(filePath, 'V2', 'utf-8')
    journal.endStep()

    const first = journal.rollbackLastStep()
    expect(first.restoredCount).toBe(1)
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('V1')

    const second = journal.rollbackLastStep()
    expect(second).toEqual({ restoredCount: 0, errors: [] })
  })

  it('rollbackLastStep should not disturb rollbackAll\'s session-wide baseline for untouched-by-that-step files', () => {
    const a = path.join(tempDir, 'a.txt')
    const b = path.join(tempDir, 'b.txt')
    fs.writeFileSync(a, 'A1', 'utf-8')
    fs.writeFileSync(b, 'B1', 'utf-8')

    // Step 1 touches both a and b.
    journal.recordBeforeModification(a)
    journal.recordBeforeModification(b)
    fs.writeFileSync(a, 'A2', 'utf-8')
    fs.writeFileSync(b, 'B2', 'utf-8')
    journal.endStep()

    // Step 2 touches only a.
    journal.recordBeforeModification(a)
    fs.writeFileSync(a, 'A3', 'utf-8')
    journal.endStep()

    journal.rollbackLastStep()
    expect(fs.readFileSync(a, 'utf-8')).toBe('A2')
    expect(fs.readFileSync(b, 'utf-8')).toBe('B2')

    // rollbackAll still restores everything to the true session start.
    journal.rollbackAll()
    expect(fs.readFileSync(a, 'utf-8')).toBe('A1')
    expect(fs.readFileSync(b, 'utf-8')).toBe('B1')
  })

  it('commit() and rollbackAll() should also clear pending per-step state', () => {
    const filePath = path.join(tempDir, 'commit-clears-step.txt')
    fs.writeFileSync(filePath, 'V1', 'utf-8')
    journal.recordBeforeModification(filePath)
    fs.writeFileSync(filePath, 'V2', 'utf-8')
    journal.endStep()

    expect(journal.canRollbackLastStep).toBe(true)
    journal.commit()
    expect(journal.canRollbackLastStep).toBe(false)
  })
})
