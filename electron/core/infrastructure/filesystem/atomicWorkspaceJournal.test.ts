import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { AtomicWorkspaceJournal, JournalSnapshotError } from './atomicWorkspaceJournal'
import { restoreAgentCheckpoint, saveAgentCheckpoint } from './agentCheckpointStore'

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

  it("rollbackLastStep should not disturb rollbackAll's session-wide baseline for untouched-by-that-step files", () => {
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

describe('AtomicWorkspaceJournal destructive snapshot completeness', () => {
  let tempDir: string
  let journal: AtomicWorkspaceJournal
  const sha = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  const inventory = (root: string): Record<string, string> => {
    const out: Record<string, string> = {}
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else out[path.relative(root, full)] = sha(full)
      }
    }
    walk(root)
    return out
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-journal-complete-'))
    journal = new AtomicWorkspaceJournal()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('refuses a directory with 2001 files without journalling any of it, and leaves the tree untouched', () => {
    const dir = path.join(tempDir, 'big')
    fs.mkdirSync(dir)
    for (let i = 0; i <= 2000; i++) fs.writeFileSync(path.join(dir, `${i}.txt`), `file ${i}`)
    expect(() => journal.recordBeforeModification(dir)).toThrow(JournalSnapshotError)
    expect(journal.trackedCount).toBe(0)
    expect(fs.readdirSync(dir)).toHaveLength(2001)
  })

  it('journals a 2000-file directory completely and restores every byte after the deletion', () => {
    const dir = path.join(tempDir, 'edge')
    fs.mkdirSync(path.join(dir, 'sub', 'deep'), { recursive: true })
    for (let i = 0; i < 1998; i++) fs.writeFileSync(path.join(dir, `${i}.txt`), `file ${i}`)
    fs.writeFileSync(path.join(dir, 'sub', 'a.bin'), Buffer.from([0, 255, 1, 254]))
    fs.writeFileSync(path.join(dir, 'sub', 'deep', 'b.txt'), 'deep')
    const before = inventory(dir)
    expect(Object.keys(before)).toHaveLength(2000)

    journal.recordBeforeModification(dir)
    fs.rmSync(dir, { recursive: true, force: true })
    const result = journal.rollbackAll()

    expect(result.errors).toEqual([])
    expect(result.restoredCount).toBe(2000)
    expect(inventory(dir)).toEqual(before)
  })

  it('resumes from a persisted checkpoint with the same inventory and SHA-256 per file', () => {
    const workspace = path.join(tempDir, 'ws')
    const dir = path.join(workspace, 'data')
    fs.mkdirSync(path.join(dir, 'nested'), { recursive: true })
    for (let i = 0; i < 300; i++) fs.writeFileSync(path.join(dir, i % 2 ? `${i}.txt` : path.join('nested', `${i}.bin`)), crypto.randomBytes(64))
    const before = inventory(dir)

    journal.recordBeforeModification(dir)
    fs.rmSync(dir, { recursive: true, force: true })
    const checkpointId = saveAgentCheckpoint(workspace, 'run-complete', journal.sessionBaseline)
    expect(checkpointId).toBeTruthy()

    const result = restoreAgentCheckpoint(workspace, checkpointId as string)
    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
    expect(inventory(dir)).toEqual(before)
  })

  it('refuses when one original cannot be read and keeps earlier entries intact', () => {
    const dir = path.join(tempDir, 'unreadable')
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, 'ok.txt'), 'ok')
    fs.writeFileSync(path.join(dir, 'locked.txt'), 'locked')
    const read = fs.readFileSync
    vi.spyOn(fs, 'readFileSync').mockImplementation(((target: unknown, ...rest: unknown[]) => {
      if (String(target).endsWith('locked.txt')) throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      return (read as (...args: unknown[]) => unknown)(target, ...rest)
    }) as never)
    expect(() => journal.recordBeforeModification(dir)).toThrow(/EACCES/)
    expect(journal.trackedCount).toBe(0)
    expect(fs.existsSync(path.join(dir, 'ok.txt'))).toBe(true)
  })

  it('refuses a directory that contains a symbolic link or a snapshot that fails midway', () => {
    const dir = path.join(tempDir, 'linked')
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, 'real.txt'), 'real')
    const targetDir = path.join(tempDir, 'link-target')
    fs.mkdirSync(targetDir)
    // A junction needs no privilege on Windows and is reported as a symbolic link by Node.
    fs.symlinkSync(targetDir, path.join(dir, 'link'), 'junction')
    expect(() => journal.recordBeforeModification(dir)).toThrow(JournalSnapshotError)
    expect(journal.trackedCount).toBe(0)
  })

  it('reports a restore whose bytes differ instead of claiming success', () => {
    const file = path.join(tempDir, 'f.txt')
    fs.writeFileSync(file, 'original')
    journal.recordBeforeModification(file)
    fs.writeFileSync(file, 'changed')
    const read = fs.readFileSync
    vi.spyOn(fs, 'readFileSync').mockImplementation(((target: unknown, ...rest: unknown[]) =>
      String(target) === file ? Buffer.from('truncated') : (read as (...args: unknown[]) => unknown)(target, ...rest)) as never)
    const result = journal.rollbackAll()
    expect(result.errors.join()).toContain('restored bytes differ')
  })
})
