import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { scanCommandTouchedFiles } from './commandTouchedFilesScanner'

/** mtime the scanner must treat as older than the command, beyond its clock tolerance. */
function ageFile(absolutePath: string, secondsOld: number) {
  const when = new Date(Date.now() - secondsOld * 1000)
  fs.utimesSync(absolutePath, when, when)
}

describe('scanCommandTouchedFiles', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-touched-test-'))
  })

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('reports a file written after the command started', () => {
    const startedAt = Date.now()
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{}')

    expect(scanCommandTouchedFiles(tempDir, startedAt).files).toEqual(['package.json'])
  })

  it('ignores files that predate the command', () => {
    const stale = path.join(tempDir, 'README.md')
    fs.writeFileSync(stale, 'pre-existing')
    ageFile(stale, 600)

    expect(scanCommandTouchedFiles(tempDir, Date.now()).files).toEqual([])
  })

  it('reports nested files as workspace-relative forward-slash paths', () => {
    const startedAt = Date.now()
    fs.mkdirSync(path.join(tempDir, 'src', 'components'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'src', 'components', 'Sidebar.tsx'), 'export const Sidebar = () => null')

    expect(scanCommandTouchedFiles(tempDir, startedAt).files).toEqual(['src/components/Sidebar.tsx'])
  })

  it('skips ignored trees so a dependency install is not reported file by file', () => {
    const startedAt = Date.now()
    fs.mkdirSync(path.join(tempDir, 'node_modules', 'react'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'node_modules', 'react', 'index.js'), 'module.exports = {}')
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{}')

    expect(scanCommandTouchedFiles(tempDir, startedAt).files).toEqual(['package.json'])
  })

  it("skips the agent's own .onlyrag session state", () => {
    const startedAt = Date.now()
    fs.mkdirSync(path.join(tempDir, '.onlyrag', 'sessions'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, '.onlyrag', 'sessions', 'state.json'), '{}')
    fs.writeFileSync(path.join(tempDir, 'index.html'), '<!doctype html>')

    expect(scanCommandTouchedFiles(tempDir, startedAt).files).toEqual(['index.html'])
  })

  it('returns results sorted for deterministic output', () => {
    const startedAt = Date.now()
    for (const name of ['vite.config.ts', 'index.html', 'package.json']) {
      fs.writeFileSync(path.join(tempDir, name), 'x')
    }

    expect(scanCommandTouchedFiles(tempDir, startedAt).files).toEqual(['index.html', 'package.json', 'vite.config.ts'])
  })

  it('flags a truncated scan once the entry budget is exhausted', () => {
    const startedAt = Date.now()
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(tempDir, `file-${i}.txt`), 'x')
    }

    const scan = scanCommandTouchedFiles(tempDir, startedAt, 2)
    expect(scan.truncated).toBe(true)
    expect(scan.files.length).toBeLessThan(5)
  })

  it('returns an empty result for a workspace path that does not exist', () => {
    expect(scanCommandTouchedFiles(path.join(tempDir, 'missing'), Date.now())).toEqual({
      files: [],
      truncated: false,
      createdTopLevelDirs: [],
    })
  })
})

describe('scanCommandTouchedFiles — nested project directories', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-nested-test-'))
  })

  afterEach(() => {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('reports a project directory a generator created in the workspace root', () => {
    const startedAt = Date.now()
    // The exact shape of session-1787476734227-nkn0 step 1.
    fs.mkdirSync(path.join(tempDir, 'project-dashboard-task', 'src'), { recursive: true })

    expect(scanCommandTouchedFiles(tempDir, startedAt).createdTopLevelDirs).toEqual(['project-dashboard-task'])
  })

  it('does not report a pre-existing directory merely because files were written into it', () => {
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'src', 'App.tsx'), 'export const App = () => null')

    // "Pre-existing" means created before the command started, and creation time is what the
    // scan reads — utimes cannot backdate it, so the command start is placed after instead.
    // This is the case that must not regress: a directory's mtime moves whenever a child is
    // written into it, so an mtime-based check would report `src` on every single command.
    const startedAfterTheDirectoryExisted = Date.now() + 5000

    expect(scanCommandTouchedFiles(tempDir, startedAfterTheDirectoryExisted).createdTopLevelDirs).toEqual([])
  })

  it('does not report ignored trees such as node_modules', () => {
    const startedAt = Date.now()
    fs.mkdirSync(path.join(tempDir, 'node_modules', 'react'), { recursive: true })

    expect(scanCommandTouchedFiles(tempDir, startedAt).createdTopLevelDirs).toEqual([])
  })

  it('reports nothing when the command created no directory', () => {
    const startedAt = Date.now()
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{}')

    expect(scanCommandTouchedFiles(tempDir, startedAt).createdTopLevelDirs).toEqual([])
  })
})
