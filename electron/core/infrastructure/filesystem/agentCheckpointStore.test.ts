import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AtomicWorkspaceJournal } from './atomicWorkspaceJournal'
import { restoreAgentCheckpoint, saveAgentCheckpoint } from './agentCheckpointStore'

describe('agent checkpoints', () => {
  let workspace: string

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-checkpoint-'))
  })

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true })
  })

  it('keeps the run on disk and restores the pre-run state on request, binary files and deleted folders included', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x10])
    fs.writeFileSync(path.join(workspace, 'logo.png'), png)
    fs.writeFileSync(path.join(workspace, 'App.tsx'), 'export const v = 1\n')
    fs.mkdirSync(path.join(workspace, 'docs', 'deep'), { recursive: true })
    fs.writeFileSync(path.join(workspace, 'docs', 'deep', 'note.md'), 'keep me\n')

    const journal = new AtomicWorkspaceJournal()
    for (const target of ['logo.png', 'App.tsx', 'docs', 'created.ts']) journal.recordBeforeModification(path.join(workspace, target))
    fs.writeFileSync(path.join(workspace, 'logo.png'), 'overwritten')
    fs.writeFileSync(path.join(workspace, 'App.tsx'), 'export const v = 2\n')
    fs.rmSync(path.join(workspace, 'docs'), { recursive: true, force: true })
    fs.writeFileSync(path.join(workspace, 'created.ts'), 'new file\n')

    const checkpointId = saveAgentCheckpoint(workspace, 'run-1', journal.sessionBaseline)
    expect(checkpointId).toBe('run-1')
    // Saving the checkpoint changes nothing: the agent's work stays until the user restores.
    expect(fs.readFileSync(path.join(workspace, 'App.tsx'), 'utf-8')).toBe('export const v = 2\n')

    const result = restoreAgentCheckpoint(workspace, 'run-1')
    expect(result).toMatchObject({ success: true, errors: [] })
    expect(fs.readFileSync(path.join(workspace, 'logo.png')).equals(png)).toBe(true)
    expect(fs.readFileSync(path.join(workspace, 'App.tsx'), 'utf-8')).toBe('export const v = 1\n')
    expect(fs.readFileSync(path.join(workspace, 'docs', 'deep', 'note.md'), 'utf-8')).toBe('keep me\n')
    expect(fs.existsSync(path.join(workspace, 'created.ts'))).toBe(false)
  })

  it('saves nothing for a run that changed no file', () => {
    expect(saveAgentCheckpoint(workspace, 'run-empty', new AtomicWorkspaceJournal().sessionBaseline)).toBeNull()
    expect(fs.existsSync(path.join(workspace, '.onlyrag', 'checkpoints', 'run-empty'))).toBe(false)
  })

  it('refuses a manifest entry that points outside the workspace', () => {
    const directory = path.join(workspace, '.onlyrag', 'checkpoints', 'evil')
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, '0.bin'), 'payload')
    fs.writeFileSync(
      path.join(directory, 'manifest.json'),
      JSON.stringify({ version: 1, checkpointId: 'evil', createdAt: '', files: [{ path: '../outside.txt', blob: '0.bin' }] }),
    )

    const result = restoreAgentCheckpoint(workspace, 'evil')
    expect(result.success).toBe(false)
    expect(result.restoredCount).toBe(0)
    expect(fs.existsSync(path.join(path.dirname(workspace), 'outside.txt'))).toBe(false)
  })

  it('rejects an id that could escape the checkpoints folder', () => {
    expect(restoreAgentCheckpoint(workspace, '../x').success).toBe(false)
  })
})
