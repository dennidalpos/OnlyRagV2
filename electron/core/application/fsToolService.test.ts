import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FsToolService } from './fsToolService'
import { AtomicWorkspaceJournal } from '../infrastructure/filesystem/atomicWorkspaceJournal'
import { agentToolFileRepository } from '../infrastructure/filesystem/agentToolFileRepository'

const temporaryDirectories: string[] = []

function createService(journal: AtomicWorkspaceJournal): FsToolService {
  return new FsToolService({
    repository: { deleteFile: async () => ({ success: true }) },
    searchRepository: { grepSearch: async () => [] },
    directoryRepository: agentToolFileRepository,
    journal,
    readContent: (filePath) => fs.readFileSync(filePath, 'utf8'),
    buildChangeStats: (filePath, before, after) => ({
      filePath,
      additions: after.length > before.length ? 1 : 0,
      deletions: before.length > after.length ? 1 : 0,
    }),
  })
}

function makeWorkspace(): string {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-fs-tool-'))
  temporaryDirectories.push(workspace)
  return workspace
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('FsToolService copy_file', () => {
  it('rejects a source outside the workspace before touching the target', () => {
    const workspace = makeWorkspace()
    const outsideSource = path.join(os.tmpdir(), `onlyrag-outside-${Date.now()}.txt`)
    const target = path.join(workspace, 'copied.txt')
    fs.writeFileSync(outsideSource, 'secret', 'utf8')

    try {
      const result = createService(new AtomicWorkspaceJournal()).executeCopyFile(
        { sourcePath: outsideSource, targetPath: target }, workspace, true,
      )

      expect(result.outputForHistory).toContain('Security Violation')
      expect(fs.existsSync(target)).toBe(false)
    } finally {
      fs.rmSync(outsideSource, { force: true })
    }
  })

  it('records the destination and rollback removes the copied file', () => {
    const workspace = makeWorkspace()
    const source = path.join(workspace, 'source.txt')
    const target = path.join(workspace, 'nested', 'copied.txt')
    const journal = new AtomicWorkspaceJournal()
    fs.writeFileSync(source, 'source text', 'utf8')

    const result = createService(journal).executeCopyFile(
      { sourcePath: source, targetPath: target }, workspace, true,
    )
    journal.endStep()

    expect(result.outputForHistory).toContain('Successfully copied')
    expect(fs.readFileSync(target, 'utf8')).toBe('source text')
    expect(journal.canRollbackLastStep).toBe(true)
    expect(journal.rollbackLastStep()).toMatchObject({ restoredCount: 1, errors: [] })
    expect(fs.existsSync(target)).toBe(false)
  })
})

describe('FsToolService move_file', () => {
  it('rejects a target outside the workspace before moving the source', () => {
    const workspace = makeWorkspace()
    const source = path.join(workspace, 'source.txt')
    const outsideTarget = path.join(os.tmpdir(), `onlyrag-outside-target-${Date.now()}.txt`)
    fs.writeFileSync(source, 'source text', 'utf8')

    const result = createService(new AtomicWorkspaceJournal()).executeMoveFile(
      { sourcePath: source, targetPath: outsideTarget }, workspace, true,
    )

    expect(result.outputForHistory).toContain('Security Violation')
    expect(fs.existsSync(source)).toBe(true)
    expect(fs.existsSync(outsideTarget)).toBe(false)
  })

  it('journals both paths so rollback restores the source and removes the target', () => {
    const workspace = makeWorkspace()
    const source = path.join(workspace, 'source.txt')
    const target = path.join(workspace, 'nested', 'moved.txt')
    const journal = new AtomicWorkspaceJournal()
    fs.writeFileSync(source, 'source text', 'utf8')

    const result = createService(journal).executeMoveFile(
      { sourcePath: source, targetPath: target }, workspace, true,
    )
    journal.endStep()

    expect(result.outputForHistory).toContain('Successfully moved')
    expect(fs.existsSync(source)).toBe(false)
    expect(fs.readFileSync(target, 'utf8')).toBe('source text')
    expect(journal.rollbackLastStep()).toMatchObject({ restoredCount: 2, errors: [] })
    expect(fs.readFileSync(source, 'utf8')).toBe('source text')
    expect(fs.existsSync(target)).toBe(false)
  })
})

describe('FsToolService grep_search', () => {
  it('rejects a search directory outside the workspace', async () => {
    const workspace = makeWorkspace()
    const searchRepository = { grepSearch: vi.fn(async () => [{ relativePath: 'outside.txt', lineNumber: 1, lineContent: 'match' }]) }
    const service = new FsToolService({
      repository: { deleteFile: async () => ({ success: true }) },
      searchRepository,
      directoryRepository: agentToolFileRepository,
      journal: new AtomicWorkspaceJournal(),
      readContent: () => '',
      buildChangeStats: (filePath, before, after) => ({ filePath, additions: 0, deletions: 0 }),
    })

    const result = await service.executeGrepSearch({ query: 'match', dirPath: path.join(os.tmpdir(), 'outside') }, workspace)

    expect(result.outputForHistory).toContain('Security Violation')
    expect(searchRepository.grepSearch).not.toHaveBeenCalled()
  })

  it('limits displayed matches to the first 50 while preserving the total count', async () => {
    const workspace = makeWorkspace()
    const matches = Array.from({ length: 60 }, (_, index) => ({
      relativePath: `file-${index}.txt`, lineNumber: 1, lineContent: 'match',
    }))
    const searchRepository = { grepSearch: async () => matches }
    const service = new FsToolService({
      repository: { deleteFile: async () => ({ success: true }) },
      searchRepository,
      directoryRepository: agentToolFileRepository,
      journal: new AtomicWorkspaceJournal(),
      readContent: () => '',
      buildChangeStats: (filePath, before, after) => ({ filePath, additions: 0, deletions: 0 }),
    })

    const result = await service.executeGrepSearch({ query: 'match', dirPath: workspace }, workspace)

    expect(result.outputForHistory).toContain('returned 60 matches (showing first 50)')
    expect(result.outputForHistory).toContain('file-49.txt')
    expect(result.outputForHistory).not.toContain('file-50.txt')
  })
})
