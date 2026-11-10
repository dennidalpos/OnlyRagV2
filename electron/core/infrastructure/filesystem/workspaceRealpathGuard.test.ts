import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validateWorkspaceRealpath } from './workspaceRealpathGuard'

describe('validateWorkspaceRealpath', () => {
  let baseDir: string
  let workspace: string
  let outside: string

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-realpath-'))
    workspace = path.join(baseDir, 'workspace with spaces')
    outside = path.join(baseDir, 'outside')
    fs.mkdirSync(workspace)
    fs.mkdirSync(outside)
  })

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true })
  })

  it('preserves valid spaces for new paths inside the workspace', () => {
    const result = validateWorkspaceRealpath('folder name/file name.txt', workspace)

    expect(result.safePath).toBe(path.join(workspace, 'folder name', 'file name.txt'))
  })

  it('rejects a new target below a symlink or junction that escapes the workspace', () => {
    const link = path.join(workspace, 'escape')
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')

    const result = validateWorkspaceRealpath(path.join('escape', 'created.txt'), workspace)

    expect(result.safePath).toBeNull()
    expect(result.error).toContain('Symlink or junction escape blocked')
  })

  it('rejects lexical traversal before checking a nonexistent target', () => {
    const result = validateWorkspaceRealpath(path.join('..', 'outside', 'new.txt'), workspace)
    expect(result.safePath).toBeNull()
    expect(result.error).toContain('outside workspace root')
    expect(fs.existsSync(path.join(outside, 'new.txt'))).toBe(false)
  })

  it('fails closed when the workspace root is unavailable', () => {
    const result = validateWorkspaceRealpath('new.txt', path.join(baseDir, 'missing-workspace'))
    expect(result.safePath).toBeNull()
    expect(result.error).toContain('Realpath validation failed')
  })
})
