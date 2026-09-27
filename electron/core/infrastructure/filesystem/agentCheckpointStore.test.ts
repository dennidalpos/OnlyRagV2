import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AtomicWorkspaceJournal } from './atomicWorkspaceJournal'
import { deleteConversationCheckpoints, restoreAgentCheckpoint, saveAgentCheckpoint } from './agentCheckpointStore'
import { ensureWorkspaceMetadataDirectory } from './workspaceMetadataDirectory'

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

  it('does not restore a manifest entry into application metadata', () => {
    ensureWorkspaceMetadataDirectory(workspace)
    const directory = path.join(workspace, '.onlyrag', 'checkpoints', 'internal')
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, '0.bin'), 'changed')
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ version: 1, files: [{ path: '.onlyrag/layout.json', blob: '0.bin' }] }))
    const layout = path.join(workspace, '.onlyrag', 'layout.json')
    const before = fs.readFileSync(layout, 'utf-8')

    expect(restoreAgentCheckpoint(workspace, 'internal').success).toBe(false)
    expect(fs.readFileSync(layout, 'utf-8')).toBe(before)
  })

  it('rejects an id that could escape the checkpoints folder', () => {
    expect(restoreAgentCheckpoint(workspace, '../x').success).toBe(false)
  })

  it('deletes only checkpoints owned or referenced by the deleted conversation', () => {
    const file = path.join(workspace, 'app.ts')
    fs.writeFileSync(file, 'before')
    const journal = new AtomicWorkspaceJournal()
    journal.recordBeforeModification(file)
    saveAgentCheckpoint(workspace, 'owned', journal.sessionBaseline, 'chat-a')
    saveAgentCheckpoint(workspace, 'other', journal.sessionBaseline, 'chat-b')
    const legacy = path.join(workspace, '.onlyrag', 'checkpoints', 'legacy')
    fs.mkdirSync(legacy)
    fs.writeFileSync(path.join(legacy, 'manifest.json'), JSON.stringify({ version: 1, checkpointId: 'legacy', files: [] }))

    deleteConversationCheckpoints(workspace, 'chat-a', ['legacy'])

    expect(fs.existsSync(path.join(workspace, '.onlyrag', 'checkpoints', 'owned'))).toBe(false)
    expect(fs.existsSync(legacy)).toBe(false)
    expect(fs.existsSync(path.join(workspace, '.onlyrag', 'checkpoints', 'other'))).toBe(true)
  })
})
