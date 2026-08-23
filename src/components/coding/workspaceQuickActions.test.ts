import { describe, it, expect } from 'vitest'
import { resolveWorkspaceQuickActions } from './workspaceQuickActions'
import { WorkspaceFile } from '../../types'

describe('resolveWorkspaceQuickActions', () => {
  it('returns empty array when workspacePath is null or empty', () => {
    expect(resolveWorkspaceQuickActions(null, [])).toEqual([])
    expect(resolveWorkspaceQuickActions('', [])).toEqual([])
    expect(resolveWorkspaceQuickActions(undefined, [])).toEqual([])
  })

  it('returns empty array when files array is empty', () => {
    expect(resolveWorkspaceQuickActions('C:/my/project', [])).toEqual([])
  })

  it('detects Node + TypeScript stack and proposes typecheck, test, build, and git status', () => {
    const files: WorkspaceFile[] = [
      { name: 'package.json', path: 'C:/project/package.json', isDir: false },
      { name: 'tsconfig.json', path: 'C:/project/tsconfig.json', isDir: false },
      { name: 'src', path: 'C:/project/src', isDir: true },
    ]
    const actions = resolveWorkspaceQuickActions('C:/project', files)
    expect(actions.length).toBeGreaterThan(0)
    expect(actions.some((a) => a.command === 'npm run typecheck')).toBe(true)
    expect(actions.some((a) => a.command === 'npm test')).toBe(true)
    expect(actions.some((a) => a.command === 'git status')).toBe(true)
  })

  it('detects Rust Cargo stack', () => {
    const files: WorkspaceFile[] = [
      { name: 'Cargo.toml', path: 'D:/rust-proj/Cargo.toml', isDir: false },
      { name: 'src', path: 'D:/rust-proj/src', isDir: true },
    ]
    const actions = resolveWorkspaceQuickActions('D:/rust-proj', files)
    expect(actions.some((a) => a.command === 'cargo test')).toBe(true)
    expect(actions.some((a) => a.command === 'cargo check')).toBe(true)
  })

  it('detects Python stack', () => {
    const files: WorkspaceFile[] = [
      { name: 'requirements.txt', path: 'D:/py-proj/requirements.txt', isDir: false },
      { name: 'main.py', path: 'D:/py-proj/main.py', isDir: false },
    ]
    const actions = resolveWorkspaceQuickActions('D:/py-proj', files)
    expect(actions.some((a) => a.command === 'pytest')).toBe(true)
  })

  it('detects Go stack', () => {
    const files: WorkspaceFile[] = [
      { name: 'go.mod', path: 'D:/go-proj/go.mod', isDir: false },
      { name: 'main.go', path: 'D:/go-proj/main.go', isDir: false },
    ]
    const actions = resolveWorkspaceQuickActions('D:/go-proj', files)
    expect(actions.some((a) => a.command === 'go test ./...')).toBe(true)
  })
})
