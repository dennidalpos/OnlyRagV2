import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { scanWorkspaceDependencies } from './dependencyScanner'
import { evaluateDependencyIntegrity } from '../../domain/agent/dependencyIntegrityGate'

let tempDir: string

function write(relativePath: string, content: string) {
  const target = path.join(tempDir, relativePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-depscan-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('scanWorkspaceDependencies', () => {
  it('reports "not scanned" rather than "clean" when there is no workspace', async () => {
    await expect(scanWorkspaceDependencies(null)).resolves.toEqual({ missing: {}, scanned: false })
  })

  it('reports "not scanned" for a workspace with no package.json', async () => {
    write('src/App.tsx', "import x from 'react-router-dom'\nexport default x")
    const result = await scanWorkspaceDependencies(tempDir)
    expect(result.scanned).toBe(false)
  })

  it('finds nothing to report when every import is declared', async () => {
    write('package.json', JSON.stringify({ name: 'app', dependencies: { react: '^18.2.0' } }))
    write('src/App.tsx', "import React from 'react'\nexport default React")

    const result = await scanWorkspaceDependencies(tempDir)

    expect(result.scanned).toBe(true)
    expect(evaluateDependencyIntegrity(result.missing, tempDir).ok).toBe(true)
  })

  it('catches the defect that shipped in session o3tx: an import nothing declares', async () => {
    write('package.json', JSON.stringify({ name: 'app', dependencies: { react: '^18.2.0' } }))
    write('src/App.tsx', "import { BrowserRouter } from 'react-router-dom'\nexport default BrowserRouter")

    const result = await scanWorkspaceDependencies(tempDir)
    const verdict = evaluateDependencyIntegrity(result.missing, tempDir)

    expect(result.scanned).toBe(true)
    expect(verdict.ok).toBe(false)
    expect(verdict.missing.map((m) => m.packageName)).toContain('react-router-dom')
    expect(verdict.directive).toContain('src/App.tsx')
  })

  it('ignores build output, so a bundled vendor import is not mistaken for source', async () => {
    write('package.json', JSON.stringify({ name: 'app', dependencies: {} }))
    write('dist/bundle.js', "require('some-vendor-package')")

    const result = await scanWorkspaceDependencies(tempDir)

    expect(evaluateDependencyIntegrity(result.missing, tempDir).ok).toBe(true)
  })

  it('refuses a partial scan when a source file cannot be parsed', async () => {
    write('package.json', '{"name":"app"}')
    write('src/broken.js', 'const = ;')
    expect((await scanWorkspaceDependencies(tempDir)).scanned).toBe(false)
  })

  it('refuses unknown peer declarations instead of silently returning a complete scan', async () => {
    write('package.json', '{"name":"app","dependencies":{"provider":"1.0.0"}}')
    write('src/app.js', "require('missing-peer')")
    write('node_modules/provider/package.json', '{invalid')
    expect((await scanWorkspaceDependencies(tempDir)).scanned).toBe(false)
  })

  it('clears the timeout after a successful scan', async () => {
    write('package.json', '{"name":"app"}')
    const setTimer = vi.spyOn(globalThis, 'setTimeout')
    const clearTimer = vi.spyOn(globalThis, 'clearTimeout')
    expect((await scanWorkspaceDependencies(tempDir, 1234)).scanned).toBe(true)
    const timerIndex = setTimer.mock.calls.findIndex((call) => call[1] === 1234)
    expect(timerIndex).toBeGreaterThanOrEqual(0)
    expect(clearTimer).toHaveBeenCalledWith(setTimer.mock.results[timerIndex].value)
  })
})
