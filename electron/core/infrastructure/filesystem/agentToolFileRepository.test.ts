import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { AgentToolFileRepository } from './agentToolFileRepository'

describe('AgentToolFileRepository Unit Tests', () => {
  const repo = new AgentToolFileRepository()
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-tool-file-repo-test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('readIfExists returns file content or an empty string when the file is missing', () => {
    const filePath = path.join(tempDir, 'a.txt')
    expect(repo.readIfExists(filePath)).toBe('')
    fs.writeFileSync(filePath, 'hello', 'utf-8')
    expect(repo.readIfExists(filePath)).toBe('hello')
  })

  it('listDirEntries returns null for a missing directory and entries otherwise', () => {
    expect(repo.listDirEntries(path.join(tempDir, 'missing'))).toBeNull()
    fs.mkdirSync(path.join(tempDir, 'sub'))
    fs.writeFileSync(path.join(tempDir, 'file.txt'), 'x', 'utf-8')
    const entries = repo.listDirEntries(tempDir)
    expect(entries).toEqual(
      expect.arrayContaining([
        { name: 'sub', isDir: true },
        { name: 'file.txt', isDir: false },
      ])
    )
  })

  it('mkdir creates nested directories', () => {
    const nested = path.join(tempDir, 'a', 'b', 'c')
    repo.mkdir(nested)
    expect(fs.existsSync(nested)).toBe(true)
  })

  it('copyFileRaw and renameRaw operate on already-existing parent directories', () => {
    const src = path.join(tempDir, 'src.txt')
    fs.writeFileSync(src, 'content', 'utf-8')

    const copyDst = path.join(tempDir, 'copy.txt')
    repo.copyFileRaw(src, copyDst)
    expect(fs.readFileSync(copyDst, 'utf-8')).toBe('content')
    expect(fs.existsSync(src)).toBe(true)

    const moveDst = path.join(tempDir, 'moved.txt')
    repo.renameRaw(src, moveDst)
    expect(fs.existsSync(src)).toBe(false)
    expect(fs.readFileSync(moveDst, 'utf-8')).toBe('content')
  })

  it('listRecursive walks nested directories, formats DIR/FILE entries, skips ignored dirs, and respects maxDepth', () => {
    fs.mkdirSync(path.join(tempDir, 'node_modules', 'pkg'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'node_modules', 'pkg', 'index.js'), 'x', 'utf-8')
    fs.mkdirSync(path.join(tempDir, 'src', 'nested'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'src', 'a.ts'), 'x', 'utf-8')
    fs.writeFileSync(path.join(tempDir, 'src', 'nested', 'b.ts'), 'x', 'utf-8')

    const shallow = repo.listRecursive(tempDir, 1, new Set(['node_modules']))
    expect(shallow.some((l) => l.includes('node_modules'))).toBe(false)
    expect(shallow).toContain('[DIR]  src/')
    expect(shallow.some((l) => l.includes('nested/b.ts'))).toBe(false)

    const deep = repo.listRecursive(tempDir, 3, new Set(['node_modules']))
    expect(deep).toContain('[FILE] src/a.ts')
    expect(deep).toContain('[FILE] src/nested/b.ts')
  })

  it('getFileInfo returns null for a missing path and stats/line-count for a text file', () => {
    expect(repo.getFileInfo(path.join(tempDir, 'missing.txt'))).toBeNull()

    const filePath = path.join(tempDir, 'text.txt')
    fs.writeFileSync(filePath, 'line1\nline2\nline3', 'utf-8')
    const info = repo.getFileInfo(filePath)
    expect(info).not.toBeNull()
    expect(info?.isDirectory).toBe(false)
    expect(info?.isBinary).toBe(false)
    expect(info?.lineCount).toBe(3)
    expect(info?.sizeBytes).toBeGreaterThan(0)
  })

  it('getFileInfo detects binary content via a null byte in the first 1KB and skips line counting', () => {
    const filePath = path.join(tempDir, 'bin.dat')
    fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]))
    const info = repo.getFileInfo(filePath)
    expect(info?.isBinary).toBe(true)
    expect(info?.lineCount).toBe(0)
  })

  it('getFileInfo reports directories without attempting to binary-sniff or count lines', () => {
    const info = repo.getFileInfo(tempDir)
    expect(info?.isDirectory).toBe(true)
    expect(info?.isBinary).toBe(false)
    expect(info?.lineCount).toBe(0)
  })

  it('readPackageJsonScripts returns the scripts map, null when missing, and null on malformed JSON', () => {
    expect(repo.readPackageJsonScripts(tempDir)).toBeNull()
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }), 'utf-8')
    expect(repo.readPackageJsonScripts(tempDir)).toEqual({ test: 'vitest run' })

    const malformedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-tool-file-repo-malformed-'))
    try {
      fs.writeFileSync(path.join(malformedDir, 'package.json'), '{ not valid', 'utf-8')
      expect(repo.readPackageJsonScripts(malformedDir)).toBeNull()
    } finally {
      fs.rmSync(malformedDir, { recursive: true, force: true })
    }
  })

  it('hasPytestConfig detects any of pytest.ini, pyproject.toml, setup.cfg', () => {
    expect(repo.hasPytestConfig(tempDir)).toBe(false)
    fs.writeFileSync(path.join(tempDir, 'pytest.ini'), '[pytest]', 'utf-8')
    expect(repo.hasPytestConfig(tempDir)).toBe(true)
  })

  describe('readDeclaredPackages', () => {
    it('returns null when there is no package.json to judge imports against', () => {
      expect(repo.readDeclaredPackages(tempDir)).toBeNull()
    })

    it('collects every dependency field', () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({
          dependencies: { react: '^18' },
          devDependencies: { vitest: '^4' },
          peerDependencies: { 'react-dom': '^18' },
          optionalDependencies: { fsevents: '^2' },
        }),
        'utf-8'
      )

      const declared = repo.readDeclaredPackages(tempDir)
      expect([...(declared?.names || [])].sort()).toEqual(['fsevents', 'react', 'react-dom', 'vitest'])
    })

    it('reads tsconfig path aliases, tolerating the comments tsconfig allows', () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ dependencies: { react: '^18' } }), 'utf-8')
      fs.writeFileSync(
        path.join(tempDir, 'tsconfig.json'),
        `{\n  // project aliases\n  "compilerOptions": { "paths": { "@/*": ["./src/*"], "~/*": ["./src/*"] } }\n}`,
        'utf-8'
      )

      expect(repo.readDeclaredPackages(tempDir)?.aliasPrefixes.sort()).toEqual(['@/', '~/'])
    })

    it('degrades to no aliases rather than throwing on an unparsable tsconfig', () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ dependencies: { react: '^18' } }), 'utf-8')
      fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), '{ not json', 'utf-8')

      expect(repo.readDeclaredPackages(tempDir)?.aliasPrefixes).toEqual([])
    })
  })

  describe('missingFromNodeModules', () => {
    it('reports every package as missing when node_modules does not exist at all', () => {
      // The workspace an agent creates: package.json authored with write_file, nothing
      // installed. Reading the declaration alone made the install guard call these "installed".
      expect(repo.missingFromNodeModules(tempDir, ['react', 'vite', '@types/react'])).toEqual([
        'react',
        'vite',
        '@types/react',
      ])
    })

    it('reports only the packages with no directory under node_modules', () => {
      fs.mkdirSync(path.join(tempDir, 'node_modules', 'react'), { recursive: true })
      expect(repo.missingFromNodeModules(tempDir, ['react', 'vite'])).toEqual(['vite'])
    })

    it('resolves a scoped package to its nested directory', () => {
      fs.mkdirSync(path.join(tempDir, 'node_modules', '@vitejs', 'plugin-react'), { recursive: true })
      expect(repo.missingFromNodeModules(tempDir, ['@vitejs/plugin-react'])).toEqual([])
      expect(repo.missingFromNodeModules(tempDir, ['@vitejs/plugin-vue'])).toEqual(['@vitejs/plugin-vue'])
    })

    it('returns nothing to install when every package is present', () => {
      fs.mkdirSync(path.join(tempDir, 'node_modules', 'react'), { recursive: true })
      fs.mkdirSync(path.join(tempDir, 'node_modules', 'vite'), { recursive: true })
      expect(repo.missingFromNodeModules(tempDir, ['react', 'vite'])).toEqual([])
    })
  })
})
