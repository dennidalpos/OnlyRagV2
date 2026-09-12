import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DisposableAgentWorkspace } from './disposableAgentWorkspace'

const roots: string[] = []

function workspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-agent-workspace-test-'))
  roots.push(root)
  return root
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('DisposableAgentWorkspace', () => {
  it('publishes only the staged file, directory, and binary changes after conflict checks', () => {
    const source = workspace()
    fs.writeFileSync(path.join(source, 'edited.txt'), 'before')
    fs.writeFileSync(path.join(source, 'deleted.txt'), 'remove me')

    const transaction = DisposableAgentWorkspace.create(source, 'publish')
    try {
      fs.writeFileSync(path.join(transaction.workspacePath, 'edited.txt'), 'after')
      fs.unlinkSync(path.join(transaction.workspacePath, 'deleted.txt'))
      fs.mkdirSync(path.join(transaction.workspacePath, 'created'), { recursive: true })
      fs.writeFileSync(path.join(transaction.workspacePath, 'created', 'asset.bin'), Buffer.from([0, 255, 4]))

      expect(transaction.preview()).toMatchObject({ createdCount: 2, deletedCount: 1, modifiedCount: 1 })
      expect(transaction.publish()).toMatchObject({ success: true })
      expect(fs.readFileSync(path.join(source, 'edited.txt'), 'utf8')).toBe('after')
      expect(fs.existsSync(path.join(source, 'deleted.txt'))).toBe(false)
      expect(fs.readFileSync(path.join(source, 'created', 'asset.bin'))).toEqual(Buffer.from([0, 255, 4]))
    } finally {
      transaction.dispose()
    }
  })

  it('does not alter the source workspace when the staged run is discarded', () => {
    const source = workspace()
    fs.writeFileSync(path.join(source, 'tracked.txt'), 'original')

    const transaction = DisposableAgentWorkspace.create(source, 'discard')
    fs.writeFileSync(path.join(transaction.workspacePath, 'tracked.txt'), 'staged only')
    fs.writeFileSync(path.join(transaction.workspacePath, 'new.txt'), 'staged only')
    transaction.dispose()

    expect(fs.readFileSync(path.join(source, 'tracked.txt'), 'utf8')).toBe('original')
    expect(fs.existsSync(path.join(source, 'new.txt'))).toBe(false)
  })

  it('uses a disposable worktree without changing a dirty Git source workspace', () => {
    const source = workspace()
    execFileSync('git', ['init'], { cwd: source })
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: source })
    execFileSync('git', ['config', 'user.name', 'OnlyRag Test'], { cwd: source })
    fs.writeFileSync(path.join(source, 'tracked.txt'), 'baseline')
    execFileSync('git', ['add', '--', 'tracked.txt'], { cwd: source })
    execFileSync('git', ['commit', '-m', 'baseline'], { cwd: source })
    fs.writeFileSync(path.join(source, 'tracked.txt'), 'dirty source')

    const transaction = DisposableAgentWorkspace.create(source, 'git')
    try {
      expect(fs.readFileSync(path.join(transaction.workspacePath, 'tracked.txt'), 'utf8')).toBe('dirty source')
      fs.writeFileSync(path.join(transaction.workspacePath, 'tracked.txt'), 'staged change')
    } finally {
      transaction.dispose()
    }

    expect(fs.readFileSync(path.join(source, 'tracked.txt'), 'utf8')).toBe('dirty source')
    expect(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: source, encoding: 'utf8' })).not.toContain('onlyrag-agent-git-')
  })
})
