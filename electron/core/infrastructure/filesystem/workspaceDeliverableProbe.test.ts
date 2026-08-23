import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createWorkspaceDeliverableProbe } from './workspaceDeliverableProbe'

describe('createWorkspaceDeliverableProbe', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-probe-test-'))
  })

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('reports an existing file with its byte size', () => {
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'src', 'App.tsx'), 'export function App() {}')

    const probe = createWorkspaceDeliverableProbe(tempDir)
    const result = probe('src/App.tsx')

    expect(result.exists).toBe(true)
    expect(result.contentLength).toBe('export function App() {}'.length)
  })

  it('reports an empty file as existing with zero content', () => {
    fs.writeFileSync(path.join(tempDir, 'index.html'), '')

    expect(createWorkspaceDeliverableProbe(tempDir)('index.html')).toEqual({ exists: true, contentLength: 0 })
  })

  it('reports a missing file as absent', () => {
    expect(createWorkspaceDeliverableProbe(tempDir)('src/pages/Tasks.tsx')).toEqual({ exists: false, contentLength: 0 })
  })

  it('reports a directory as absent so it never satisfies a file deliverable', () => {
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true })

    expect(createWorkspaceDeliverableProbe(tempDir)('src')).toEqual({ exists: false, contentLength: 0 })
  })

  it('refuses to probe outside the workspace root', () => {
    const outsideFile = path.join(os.tmpdir(), `onlyrag-outside-${Date.now()}.txt`)
    fs.writeFileSync(outsideFile, 'secret')
    try {
      const probe = createWorkspaceDeliverableProbe(tempDir)
      expect(probe(`../${path.basename(outsideFile)}`)).toEqual({ exists: false, contentLength: 0 })
    } finally {
      fs.rmSync(outsideFile, { force: true })
    }
  })

  it('reports an empty candidate path as absent', () => {
    expect(createWorkspaceDeliverableProbe(tempDir)('')).toEqual({ exists: false, contentLength: 0 })
  })
})
