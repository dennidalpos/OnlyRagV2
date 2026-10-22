import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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
    expect(
      validateDocumentation({
        docsRoot: path.join(tempDir, 'docs'),
        packageJsonPath: path.join(tempDir, 'package.json'),
      }),
    ).toEqual({
      filesChecked: 2,
      errors: [],
    })
  })

  it('reports broken links and unknown npm scripts', () => {
    fs.writeFileSync(path.join(tempDir, 'docs', 'index.md'), '[Missing](missing.md)\n`npm run deploy`')
    expect(
      validateDocumentation({
        docsRoot: path.join(tempDir, 'docs'),
        packageJsonPath: path.join(tempDir, 'package.json'),
      }).errors,
    ).toEqual(["docs/index.md: broken local link 'missing.md'", "docs/index.md: undocumented npm script 'deploy' does not exist in package.json"])
  })

  it('checks heading anchors, including duplicate headings', () => {
    fs.writeFileSync(
      path.join(tempDir, 'docs', 'index.md'),
      '[First](architecture.md#section) [Second](architecture.md#section-1) [Bad](architecture.md#missing)',
    )
    fs.writeFileSync(path.join(tempDir, 'docs', 'architecture.md'), '# Section\n\n## Section\n')
    expect(
      validateDocumentation({
        docsRoot: path.join(tempDir, 'docs'),
        packageJsonPath: path.join(tempDir, 'package.json'),
      }).errors,
    ).toEqual(["docs/index.md: broken local anchor 'architecture.md#missing'"])
  })

  it('checks anchors within the same file', () => {
    fs.writeFileSync(path.join(tempDir, 'docs', 'index.md'), '# Available\n\n[Good](#available) [Bad](#absent)')
    expect(
      validateDocumentation({
        docsRoot: path.join(tempDir, 'docs'),
        packageJsonPath: path.join(tempDir, 'package.json'),
      }).errors,
    ).toEqual(["docs/index.md: broken local anchor '#absent'"])
  })

  it('also validates explicitly supplied documentation sources', () => {
    const readmePath = path.join(tempDir, 'README.md')
    fs.writeFileSync(readmePath, '[Architecture](docs/architecture.md)')
    fs.writeFileSync(path.join(tempDir, 'docs', 'architecture.md'), '# Architecture')
    expect(
      validateDocumentation({
        docsRoot: path.join(tempDir, 'docs'),
        packageJsonPath: path.join(tempDir, 'package.json'),
        additionalFiles: [readmePath],
      }),
    ).toEqual({ filesChecked: 2, errors: [] })
  })

  it('validates Mermaid flowchart syntax, decision branches, and reachability', () => {
    fs.writeFileSync(
      path.join(tempDir, 'docs', 'flows.md'),
      [
        '# Flussi',
        '',
        '```mermaid',
        'flowchart TD',
        '  start(["Avvio"])',
        '  check{"Servizio attivo?"}',
        '  ok(["Pronto"])',
        '  recover(["Ripristina"])',
        '  start --> check',
        '  check -- "Sì" --> ok',
        '  check -- "No" --> recover',
        '```',
      ].join('\n'),
    )
    expect(
      validateDocumentation({
        docsRoot: path.join(tempDir, 'docs'),
        packageJsonPath: path.join(tempDir, 'package.json'),
      }),
    ).toEqual({
      filesChecked: 1,
      errors: [],
    })
  })

  it('reports invalid Mermaid syntax, single-branch decisions, and unreachable nodes', () => {
    fs.writeFileSync(
      path.join(tempDir, 'docs', 'bad-flows.md'),
      [
        '# Flussi non validi',
        '',
        '```mermaid',
        'flowchart TD',
        '  start(["Avvio"])',
        '  check{"Scelta incompleta?"}',
        '  ok(["Esito"])',
        '  orphan(["Nodo isolato"])',
        '  start --> check',
        '  check -- "Sì" --> ok',
        '```',
      ].join('\n'),
    )
    expect(
      validateDocumentation({
        docsRoot: path.join(tempDir, 'docs'),
        packageJsonPath: path.join(tempDir, 'package.json'),
      }).errors,
    ).toEqual([
      "docs/bad-flows.md (mermaid #1): decision node 'check' must have at least 2 outgoing branches",
      "docs/bad-flows.md (mermaid #1): unreachable or isolated node 'orphan'",
    ])
  })

  it('exits non-zero when the CLI finds a documentation error', () => {
    fs.writeFileSync(path.join(tempDir, 'docs', 'index.md'), '[Missing](missing.md)')
    expect(() =>
      execFileSync(process.execPath, [path.resolve('scripts/validate_documentation.mjs'), path.join(tempDir, 'docs'), path.join(tempDir, 'package.json')], {
        stdio: 'pipe',
      }),
    ).toThrow()
  })
})
