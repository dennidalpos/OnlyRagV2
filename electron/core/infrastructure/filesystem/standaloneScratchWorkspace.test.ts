import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StandaloneScratchWorkspace } from './standaloneScratchWorkspace'

describe('StandaloneScratchWorkspace', () => {
  let basePath: string
  let exportRoot: string

  beforeEach(() => {
    basePath = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-scratch-test-'))
    exportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-scratch-export-'))
  })

  afterEach(() => {
    fs.rmSync(basePath, { recursive: true, force: true })
    fs.rmSync(exportRoot, { recursive: true, force: true })
  })

  it('keeps one stable persistent path and exports its files', () => {
    const workspace = new StandaloneScratchWorkspace(basePath)
    const scratchPath = workspace.getPath()
    fs.writeFileSync(path.join(scratchPath, 'note.md'), '# persistent\n')

    expect(workspace.getPath()).toBe(scratchPath)
    const result = workspace.exportTo(exportRoot)

    expect(result.success).toBe(true)
    expect(fs.readFileSync(path.join(result.path!, 'note.md'), 'utf-8')).toBe('# persistent\n')
    expect(fs.existsSync(path.join(scratchPath, 'note.md'))).toBe(true)
  })

  it('clears contents without deleting the scratch root', () => {
    const workspace = new StandaloneScratchWorkspace(basePath)
    const scratchPath = workspace.getPath()
    fs.mkdirSync(path.join(scratchPath, 'nested'))
    fs.writeFileSync(path.join(scratchPath, 'nested', 'file.txt'), 'content')

    expect(workspace.clear()).toEqual({ success: true, removedEntries: 1 })
    expect(fs.existsSync(scratchPath)).toBe(true)
    expect(fs.readdirSync(scratchPath)).toEqual([])
  })

  it('refuses to export into the scratch tree', () => {
    const workspace = new StandaloneScratchWorkspace(basePath)
    const scratchPath = workspace.getPath()
    const nested = path.join(scratchPath, 'exports')
    fs.mkdirSync(nested)

    expect(workspace.exportTo(nested)).toEqual({
      success: false,
      error: 'Scegli una destinazione esterna al workspace scratch.',
    })
  })
})
