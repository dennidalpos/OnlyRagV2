import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { TransactionalExecutionGuard } from './transactionalExecutionGuard'

describe('TransactionalExecutionGuard Unit Tests', () => {
  let tempDir: string
  let guard: TransactionalExecutionGuard

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-guard-test-'))
    guard = new TransactionalExecutionGuard(tempDir)
  })

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('should capture SHA-256 workspace snapshot and produce deterministic tree hash', () => {
    const file1 = path.join(tempDir, 'file1.txt')
    const file2 = path.join(tempDir, 'file2.txt')
    fs.writeFileSync(file1, 'Hello World', 'utf-8')
    fs.writeFileSync(file2, 'TypeScript Test', 'utf-8')

    const snap1 = guard.captureWorkspaceSnapshot(['file1.txt', 'file2.txt'])
    expect(snap1.fileHashes.size).toBe(2)
    expect(snap1.combinedTreeHash).toBeDefined()
    expect(snap1.combinedTreeHash.length).toBe(64)

    const snap2 = guard.captureWorkspaceSnapshot(['file1.txt', 'file2.txt'])
    expect(snap2.combinedTreeHash).toBe(snap1.combinedTreeHash)
  })

  it('should detect state oscillation when filesystem reverts back to previous SHA-256 state', () => {
    const file1 = path.join(tempDir, 'file1.txt')
    fs.writeFileSync(file1, 'Version 1', 'utf-8')

    const snap1 = guard.captureWorkspaceSnapshot(['file1.txt'])
    
    fs.writeFileSync(file1, 'Version 2', 'utf-8')
    guard.captureWorkspaceSnapshot(['file1.txt'])

    fs.writeFileSync(file1, 'Version 1', 'utf-8') // Revert to Version 1
    const snap3 = guard.captureWorkspaceSnapshot(['file1.txt'])

    fs.writeFileSync(file1, 'Version 2', 'utf-8')
    guard.captureWorkspaceSnapshot(['file1.txt'])

    fs.writeFileSync(file1, 'Version 1', 'utf-8') // Revert to Version 1 again
    const snap5 = guard.captureWorkspaceSnapshot(['file1.txt'])

    const check = guard.detectStateStagnation(snap5)
    expect(check.allowed).toBe(false)
    expect(check.reason).toContain('Oscillation Detected')
  })

  it('should enforce Definition of Done gating when unverified milestones or unverified build changes exist', () => {
    // 1. Pending milestones block finish
    const check1 = guard.validateTaskCompletion({
      requireVerifiedBuild: true,
      hasVerifiedBuild: false,
      pendingMilestonesCount: 2,
      hasFileMutations: false,
    })
    expect(check1.allowed).toBe(false)
    expect(check1.reason).toContain('Unverified Milestones')

    // 2. Unverified build after file mutations blocks finish
    const check2 = guard.validateTaskCompletion({
      requireVerifiedBuild: true,
      hasVerifiedBuild: false,
      pendingMilestonesCount: 0,
      hasFileMutations: true,
    })
    expect(check2.allowed).toBe(false)
    expect(check2.reason).toContain('No Verified Build')

    // 3. Fully verified build and zero pending milestones allows finish
    const check3 = guard.validateTaskCompletion({
      requireVerifiedBuild: true,
      hasVerifiedBuild: true,
      pendingMilestonesCount: 0,
      hasFileMutations: true,
    })
    expect(check3.allowed).toBe(true)
  })
})
