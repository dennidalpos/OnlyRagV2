import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scanUndeclaredImports } from './undeclaredImportScanner'

/**
 * The case this scanner was written for, reproduced from the live run of 2026-08-24:
 * `vite.config.ts` imports `@vitejs/plugin-react`, `package.json` declares only `react` and
 * `vite`, and every `npm run build` of that session died on "Cannot find module".
 */

let workspace: string

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-undeclared-'))
})

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true })
})

function write(rel: string, body: string) {
  const abs = path.join(workspace, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, body, 'utf-8')
}

function manifest(deps: Record<string, string>, dev: Record<string, string> = {}) {
  write('package.json', JSON.stringify({ name: 'probe', dependencies: deps, devDependencies: dev }, null, 2))
}

describe('scanUndeclaredImports', () => {
  it('finds the undeclared plugin in the config file and names the importer', () => {
    manifest({ react: '^18.0.0' }, { vite: '^4.0.0' })
    write('vite.config.ts', "import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\nexport default defineConfig({ plugins: [react()] })\n")

    expect(scanUndeclaredImports(workspace)).toEqual([
      { packageName: '@vitejs/plugin-react', importedBy: ['vite.config.ts'] },
    ])
  })

  it('collects every file importing the same undeclared package', () => {
    manifest({ react: '^18.0.0' })
    write('src/App.tsx', "import { BrowserRouter } from 'react-router-dom'\nexport default function App() { return null }\n")
    write('src/main.tsx', "import { Routes } from 'react-router-dom'\nexport const r = Routes\n")

    const found = scanUndeclaredImports(workspace)

    expect(found).toHaveLength(1)
    expect(found[0].packageName).toBe('react-router-dom')
    expect(found[0].importedBy).toEqual(['src/App.tsx', 'src/main.tsx'])
  })

  it('says nothing about a project whose imports are all declared', () => {
    manifest({ react: '^18.0.0', 'react-dom': '^18.0.0' })
    write('src/main.tsx', "import { createRoot } from 'react-dom/client'\nimport React from 'react'\nexport const x = { createRoot, React }\n")

    expect(scanUndeclaredImports(workspace)).toEqual([])
  })

  it('leaves relative paths and Node builtins alone', () => {
    manifest({ react: '^18.0.0' })
    write('src/util.ts', "import fs from 'node:fs'\nimport path from 'path'\nimport { helper } from './helper'\nexport const y = { fs, path, helper }\n")
    write('src/helper.ts', 'export const helper = 1\n')

    expect(scanUndeclaredImports(workspace)).toEqual([])
  })

  it('treats a tsconfig path alias as a local import, not a missing package', () => {
    manifest({ react: '^18.0.0' })
    write('tsconfig.json', JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }))
    write('src/App.tsx', "import { api } from '@/services/api'\nexport const a = api\n")

    expect(scanUndeclaredImports(workspace)).toEqual([])
  })

  it('says nothing at all without a manifest, rather than reporting every import', () => {
    write('src/App.tsx', "import React from 'react'\nexport default React\n")

    expect(scanUndeclaredImports(workspace)).toEqual([])
  })

  it('reports external imports for a manifest that declares no dependency', () => {
    write('package.json', JSON.stringify({ name: 'too-early' }))
    write('src/App.tsx', "import React from 'react'\nexport default React\n")

    expect(scanUndeclaredImports(workspace)).toEqual([
      { packageName: 'react', importedBy: ['src/App.tsx'] },
    ])
  })

  it('never walks into node_modules', () => {
    manifest({ react: '^18.0.0' })
    write('node_modules/some-pkg/index.js', "require('a-package-nobody-declared')\n")

    expect(scanUndeclaredImports(workspace)).toEqual([])
  })

  it('stops at the file ceiling instead of walking an unbounded tree', () => {
    manifest({ react: '^18.0.0' })
    for (let i = 0; i < 12; i++) write(`src/f${i}.ts`, `import x from 'pkg-${i}'\nexport default x\n`)

    // The cap is what keeps this affordable on every turn; the scan reports what it saw and
    // never claims the tree was exhausted.
    expect(scanUndeclaredImports(workspace, 5)).toHaveLength(5)
  })
})
