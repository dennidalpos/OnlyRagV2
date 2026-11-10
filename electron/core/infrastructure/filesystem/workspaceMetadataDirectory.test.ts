import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureWorkspaceMetadataDirectory, workspaceMetadataStatePath, workspaceMetadataTrackerPath } from './workspaceMetadataDirectory'

const workspaces: string[] = []

function workspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-layout-'))
  workspaces.push(root)
  return root
}

afterEach(() => {
  for (const root of workspaces.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('workspace metadata layout', () => {
  it('initializes an empty Agent Coding project with ignored, isolated session paths', () => {
    const root = workspace()
    const metadata = ensureWorkspaceMetadataDirectory(root)
    expect(fs.readFileSync(path.join(metadata, '.gitignore'), 'utf-8')).toContain('*')
    expect(JSON.parse(fs.readFileSync(path.join(metadata, 'layout.json'), 'utf-8'))).toEqual({ version: 2 })
    expect(workspaceMetadataStatePath(root, 'chat/a')).not.toBe(workspaceMetadataStatePath(root, 'chat_a'))
    expect(workspaceMetadataStatePath(root, 'chat/a')).toContain(createHash('sha256').update('chat/a').digest('hex'))
  })

  it('migrates one legacy conversation and keeps verified originals in a backup', () => {
    const root = workspace()
    const sessions = path.join(root, '.onlyrag', 'sessions')
    const assistant = path.join(root, '.onlyrag', 'assistant')
    fs.mkdirSync(sessions, { recursive: true })
    fs.mkdirSync(assistant)
    fs.writeFileSync(path.join(sessions, 'session_history.json'), JSON.stringify({ version: 1, sessions: [{ id: 'chat/a' }] }))
    fs.writeFileSync(path.join(sessions, '.agent_state_chat_a.json'), JSON.stringify({ sessionId: 'chat/a', agentMode: 'guided' }))
    fs.writeFileSync(path.join(assistant, 'SESSION_TRACKER.md'), '# SESSION_TRACKER\n## completed_tasks\n- [x] Done')

    ensureWorkspaceMetadataDirectory(root)
    expect(fs.readFileSync(workspaceMetadataStatePath(root, 'chat/a'), 'utf-8')).toContain('chat/a')
    expect(fs.readFileSync(workspaceMetadataTrackerPath(root, 'chat/a'), 'utf-8')).toContain('Done')
    expect(fs.existsSync(path.join(sessions, 'history.json'))).toBe(true)
    expect(fs.existsSync(path.join(sessions, 'session_history.json'))).toBe(false)
    expect(fs.existsSync(path.join(root, '.onlyrag', 'migration-backup', 'v1', 'sessions', 'session_history.json'))).toBe(true)
    ensureWorkspaceMetadataDirectory(root)
  })

  it('does not attach an ambiguous old tracker to either conversation', () => {
    const root = workspace()
    const sessions = path.join(root, '.onlyrag', 'sessions')
    fs.mkdirSync(sessions, { recursive: true })
    fs.writeFileSync(path.join(sessions, 'session_history.json'), JSON.stringify({ version: 1, sessions: [{ id: 'first' }, { id: 'second' }] }))
    fs.mkdirSync(path.join(root, '.onlyrag', 'assistant'))
    fs.writeFileSync(path.join(root, '.onlyrag', 'assistant', 'SESSION_TRACKER.md'), '# old')

    ensureWorkspaceMetadataDirectory(root)
    expect(fs.existsSync(workspaceMetadataTrackerPath(root, 'first'))).toBe(false)
    expect(fs.existsSync(workspaceMetadataTrackerPath(root, 'second'))).toBe(false)
    expect(fs.readFileSync(path.join(root, '.onlyrag', 'legacy-unassigned', 'SESSION_TRACKER.md'), 'utf-8')).toBe('# old')
  })

  it('resumes a partially copied migration without overwriting its source', () => {
    const root = workspace()
    const sessions = path.join(root, '.onlyrag', 'sessions')
    fs.mkdirSync(sessions, { recursive: true })
    const old = path.join(sessions, 'session_history.json')
    const content = JSON.stringify({ version: 1, sessions: [{ id: 'one' }] })
    fs.writeFileSync(old, content)
    fs.writeFileSync(path.join(sessions, 'history.json'), content)

    ensureWorkspaceMetadataDirectory(root)
    expect(fs.readFileSync(path.join(sessions, 'history.json'), 'utf-8')).toBe(content)
    expect(fs.existsSync(old)).toBe(false)
  })

  it('stops on a conflicting partial copy and resumes after that copy is repaired', () => {
    const root = workspace()
    const sessions = path.join(root, '.onlyrag', 'sessions')
    fs.mkdirSync(sessions, { recursive: true })
    const old = path.join(sessions, 'session_history.json')
    const target = path.join(sessions, 'history.json')
    const content = JSON.stringify({ version: 1, sessions: [{ id: 'one' }] })
    fs.writeFileSync(old, content)
    fs.writeFileSync(target, 'different')

    expect(() => ensureWorkspaceMetadataDirectory(root)).toThrow('migration conflict')
    expect(fs.existsSync(old)).toBe(true)
    expect(fs.existsSync(path.join(root, '.onlyrag', 'layout.json'))).toBe(false)
    fs.writeFileSync(target, content)
    ensureWorkspaceMetadataDirectory(root)
    expect(fs.existsSync(old)).toBe(false)
  })

  it('finishes source cleanup after the version marker was written', () => {
    const root = workspace()
    const sessions = path.join(root, '.onlyrag', 'sessions')
    const backup = path.join(root, '.onlyrag', 'migration-backup', 'v1', 'sessions')
    fs.mkdirSync(sessions, { recursive: true })
    fs.mkdirSync(backup, { recursive: true })
    const old = path.join(sessions, 'session_history.json')
    const content = JSON.stringify({ version: 1, sessions: [] })
    fs.writeFileSync(old, content)
    fs.writeFileSync(path.join(backup, 'session_history.json'), content)
    fs.writeFileSync(path.join(sessions, 'history.json'), content)
    fs.writeFileSync(path.join(root, '.onlyrag', 'layout.json'), '{"version":2}')

    ensureWorkspaceMetadataDirectory(root)
    expect(fs.existsSync(old)).toBe(false)
  })
})
