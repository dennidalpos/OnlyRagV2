import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { generateCompactRepoMap } from './compactSemanticRepoMapper'

describe('CompactSemanticRepoMapper Unit Tests', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-repomap-test-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('should map HTML, CSS, JSON and other files alongside TS/JS files', () => {
    fs.writeFileSync(path.join(tempDir, 'index.html'), '<!DOCTYPE html><html><body>Hello</body></html>')
    fs.writeFileSync(path.join(tempDir, 'styles.css'), 'body { margin: 0; }')
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name": "test-app"}')
    fs.writeFileSync(
      path.join(tempDir, 'app.ts'),
      'export function initApp(): void {}\nexport class MainService {}'
    )

    const map = generateCompactRepoMap(tempDir)

    expect(map).toContain('📄 index.html')
    expect(map).toContain('📄 styles.css')
    expect(map).toContain('📄 package.json')
    expect(map).toContain('📄 app.ts ➔ { export function initApp, export class MainService }')
  })

  it('should ignore node_modules, .git, and dist folders', () => {
    const nodeModules = path.join(tempDir, 'node_modules')
    fs.mkdirSync(nodeModules)
    fs.writeFileSync(path.join(nodeModules, 'dummy.js'), 'console.log()')

    fs.writeFileSync(path.join(tempDir, 'main.js'), 'function run() {}')

    const map = generateCompactRepoMap(tempDir)

    expect(map).not.toContain('node_modules')
    expect(map).toContain('📄 main.js')
  })
})
