import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ProjectStackDetectionRepository } from './projectStackDetectionRepository'

describe('ProjectStackDetectionRepository Unit Tests', () => {
  const repo = new ProjectStackDetectionRepository()
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-stack-test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('should return an empty stack for a missing or unset workspace path', () => {
    expect(repo.detect(null)).toEqual([])
    expect(repo.detect(path.join(tempDir, 'does-not-exist'))).toEqual([])
  })

  it('should detect npm dependencies (scoped and unscoped) from package.json', () => {
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ dependencies: { react: '^19.0.0', '@tailwindcss/vite': '^4.0.0' }, devDependencies: { vitest: '^4.0.0' } }),
      'utf-8'
    )
    const stack = repo.detect(tempDir)
    expect(stack).toContain('react')
    expect(stack).toContain('vite')
    expect(stack).toContain('@tailwindcss/vite')
    expect(stack).toContain('vitest')
  })

  it('should detect Python from requirements.txt and pyproject.toml, ignoring comments and version pins', () => {
    fs.writeFileSync(path.join(tempDir, 'requirements.txt'), '# comment\nfastapi==0.110.0\nuvicorn>=0.25\n', 'utf-8')
    const stack = repo.detect(tempDir)
    expect(stack).toContain('python')
    expect(stack).toContain('fastapi')
    expect(stack).toContain('uvicorn')
    expect(stack).not.toContain('# comment')
  })

  it('should detect Rust and Go tooling from their manifest files', () => {
    fs.writeFileSync(path.join(tempDir, 'Cargo.toml'), '[package]\nname = "x"\n', 'utf-8')
    fs.writeFileSync(path.join(tempDir, 'go.mod'), 'module x\n', 'utf-8')
    const stack = repo.detect(tempDir)
    expect(stack).toEqual(expect.arrayContaining(['rust', 'cargo', 'go', 'golang']))
  })

  it('should not throw on a malformed package.json and should return whatever else it detected', () => {
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{ not valid json', 'utf-8')
    fs.writeFileSync(path.join(tempDir, 'go.mod'), 'module x\n', 'utf-8')
    expect(() => repo.detect(tempDir)).not.toThrow()
    // A parse failure aborts the whole try block, so even the sibling go.mod check is skipped.
    expect(repo.detect(tempDir)).toEqual([])
  })
})
