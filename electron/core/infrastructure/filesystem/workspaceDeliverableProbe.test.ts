import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { captureWorkspaceVersion, createWorkspaceDeliverableProbe } from './workspaceDeliverableProbe'

describe('createWorkspaceDeliverableProbe', () => {
  it('changes workspace evidence for source edits but ignores agent state and build output', () => {
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'src', 'app.ts'), 'export const value = 1')
    const before = captureWorkspaceVersion(tempDir)
    fs.mkdirSync(path.join(tempDir, '.onlyrag'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, '.onlyrag', 'state.json'), '{}')
    fs.mkdirSync(path.join(tempDir, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'dist', 'app.js'), 'bundle')
    expect(captureWorkspaceVersion(tempDir)).toBe(before)
    fs.writeFileSync(path.join(tempDir, 'src', 'app.ts'), 'export const value = 1000')
    expect(captureWorkspaceVersion(tempDir)).not.toBe(before)
  })

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

  it('finds a unique script module with a different extension in the same directory', () => {
    fs.mkdirSync(path.join(tempDir, 'src', 'pages'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'src', 'pages', 'Tasks.tsx'), 'export const Tasks = () => null')

    expect(createWorkspaceDeliverableProbe(tempDir)('src/pages/Tasks.jsx').exists).toBe(true)
    expect(createWorkspaceDeliverableProbe(tempDir)('src/Tasks.jsx').exists).toBe(false)
  })

  it('rejects ambiguous script module aliases', () => {
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'src', 'App.jsx'), 'export const App = () => null')
    fs.writeFileSync(path.join(tempDir, 'src', 'App.tsx'), 'export const App = () => null')

    expect(createWorkspaceDeliverableProbe(tempDir)('src/App.js').exists).toBe(false)
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

/** The churn that dominated the live run of 2026-08-24, traced to this adapter. */
describe('a deliverable named without a directory is a name, not a location', () => {
  it('finds the file the model actually wrote, in the directory it chose', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-probe-bare-'))
    try {
      fs.mkdirSync(path.join(dir, 'src', 'styles'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'src', 'styles', 'globals.css'), '@tailwind base;\n@tailwind components;\n@tailwind utilities;', 'utf-8')

      const result = createWorkspaceDeliverableProbe(dir)('globals.css')

      expect(result.exists).toBe(true)
      expect(result.content).toContain('@tailwind base')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('prefers the copy at the root when both exist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-probe-bare-'))
    try {
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'config.js'), 'module.exports = { root: true }\n', 'utf-8')
      fs.writeFileSync(path.join(dir, 'src', 'config.js'), 'module.exports = { nested: true }\n', 'utf-8')

      expect(createWorkspaceDeliverableProbe(dir)('config.js').content).toContain('root: true')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps exact-path semantics for a deliverable that names a directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-probe-bare-'))
    try {
      fs.mkdirSync(path.join(dir, 'src', 'components'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'src', 'components', 'Tasks.tsx'), 'export const Tasks = () => null\n', 'utf-8')

      // The title stated a location, so a file somewhere else is not that deliverable.
      expect(createWorkspaceDeliverableProbe(dir)('src/pages/Tasks.tsx').exists).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('never reports a file outside the workspace', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-probe-bare-'))
    try {
      expect(createWorkspaceDeliverableProbe(dir)('../package.json').exists).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not go looking inside node_modules', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-probe-bare-'))
    try {
      fs.mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'node_modules', 'pkg', 'globals.css'), 'body { color: red }\n', 'utf-8')

      expect(createWorkspaceDeliverableProbe(dir)('globals.css').exists).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
