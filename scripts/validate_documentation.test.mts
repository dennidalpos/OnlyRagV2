import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { validateDocumentation } from './validate_documentation.mjs'

describe('documentation validation', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-docs-'))
    fs.mkdirSync(path.join(tempDir, 'docs'))
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ scripts: { build: 'vite build' } }))
  })

  afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  it('accepts existing local links and npm scripts', () => {
    fs.writeFileSync(path.join(tempDir, 'docs', 'index.md'), '[Architecture](architecture.md)\n`npm run build`')
    fs.writeFileSync(path.join(tempDir, 'docs', 'architecture.md'), '# Architecture')
    expect(validateDocumentation({ docsRoot: path.join(tempDir, 'docs'), packageJsonPath: path.join(tempDir, 'package.json') })).toEqual({ filesChecked: 2, errors: [] })
  })

  it('reports broken links and unknown npm scripts', () => {
    fs.writeFileSync(path.join(tempDir, 'docs', 'index.md'), '[Missing](missing.md)\n`npm run deploy`')
    expect(validateDocumentation({ docsRoot: path.join(tempDir, 'docs'), packageJsonPath: path.join(tempDir, 'package.json') }).errors).toEqual([
      "docs/index.md: broken local link 'missing.md'",
      "docs/index.md: undocumented npm script 'deploy' does not exist in package.json",
    ])
  })

  it('exits non-zero when the CLI finds a documentation error', () => {
    fs.writeFileSync(path.join(tempDir, 'docs', 'index.md'), '[Missing](missing.md)')
    expect(() => execFileSync(process.execPath, [path.resolve('scripts/validate_documentation.mjs'), path.join(tempDir, 'docs'), path.join(tempDir, 'package.json')], { stdio: 'pipe' })).toThrow()
  })
})
