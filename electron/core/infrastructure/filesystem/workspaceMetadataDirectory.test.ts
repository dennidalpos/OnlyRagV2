import { createFixtureDirectory, retainFixture } from '../../../../scripts/test/fixtureRuntime.mjs'
import { createHash } from 'node:crypto'
import fs from 'node:fs'

import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureWorkspaceMetadataDirectory, workspaceMetadataStatePath, workspaceMetadataTrackerPath } from './workspaceMetadataDirectory'

const workspaces: string[] = []

function workspace(): string {
  const root = createFixtureDirectory('onlyrag-layout-')
  workspaces.push(root)
  return root
}

afterEach(() => {
  for (const root of workspaces.splice(0)) retainFixture(root)
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

  it.each(['sessions/session_history.json', 'sessions/.agent_state_old.json', 'assistant/SESSION_TRACKER.md', 'sessions/history.json'])(
    'refuses previous or unversioned metadata at %s without changing originals',
    (relative) => {
      const root = workspace()
      const metadata = path.join(root, '.onlyrag')
      const source = path.join(metadata, relative)
      fs.mkdirSync(path.dirname(source), { recursive: true })
      const original = Buffer.from('retained original bytes')
      fs.writeFileSync(source, original)
      expect(() => ensureWorkspaceMetadataDirectory(root)).toThrow('Unsupported')
      expect(fs.readFileSync(source)).toEqual(original)
      expect(fs.existsSync(path.join(metadata, 'layout.json'))).toBe(false)
      expect(fs.existsSync(path.join(metadata, 'migration-backup'))).toBe(false)
    },
  )

  it('reopens current metadata without cleaning up retained previous-layout sources or backups', () => {
    const root = workspace()
    const metadata = ensureWorkspaceMetadataDirectory(root)
    const tracker = workspaceMetadataTrackerPath(root, 'current')
    fs.mkdirSync(path.dirname(tracker), { recursive: true })
    fs.writeFileSync(tracker, '# current')
    expect(ensureWorkspaceMetadataDirectory(root)).toBe(metadata)
    expect(fs.readFileSync(tracker, 'utf8')).toBe('# current')
    const backup = path.join(metadata, 'migration-backup', 'v1', 'original.bin')
    fs.mkdirSync(path.dirname(backup), { recursive: true })
    fs.writeFileSync(backup, Buffer.from([0, 255, 1]))
    expect(ensureWorkspaceMetadataDirectory(root)).toBe(metadata)
    expect(fs.readFileSync(backup)).toEqual(Buffer.from([0, 255, 1]))
    const old = path.join(metadata, 'sessions', 'session_history.json')
    fs.writeFileSync(old, 'old')
    expect(() => ensureWorkspaceMetadataDirectory(root)).toThrow('Unsupported previous')
    expect(fs.readFileSync(old, 'utf8')).toBe('old')
    expect(fs.readFileSync(tracker, 'utf8')).toBe('# current')
  })

  it.each(['{"version":1}', '{broken'])('refuses unsupported or corrupt layout markers without rewriting them', (raw) => {
    const root = workspace()
    const metadata = path.join(root, '.onlyrag')
    fs.mkdirSync(metadata)
    const marker = path.join(metadata, 'layout.json')
    fs.writeFileSync(marker, raw)
    expect(() => ensureWorkspaceMetadataDirectory(root)).toThrow()
    expect(fs.readFileSync(marker, 'utf8')).toBe(raw)
    expect(fs.readdirSync(metadata)).toEqual(['layout.json'])
  })
})
