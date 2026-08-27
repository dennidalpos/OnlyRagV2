import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { readLocalModuleExports, readPackageExports, extractExportedNames } from './packageExportScanner'

/**
 * Measured 2026-08-25T19:59, session live-full-task, steps 42-43. The build reported that
 * `@headlessui/react` exports neither `Card` nor `List`; the directive ordered TaskCard.tsx
 * rewritten; the model rewrote it with the identical import. It had no second candidate and no
 * way to obtain one: it never calls `read_file`, and the answer lives in a .d.ts under
 * node_modules. This reads it.
 */

let tempDir: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-exports-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

function installPackage(name: string, files: Record<string, string>) {
  const root = path.join(tempDir, 'node_modules', ...name.split('/'))
  fs.mkdirSync(root, { recursive: true })
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, ...relative.split('/'))
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content, 'utf-8')
  }
}

describe('extractExportedNames', () => {
  it('reads the declaration forms a package entry point actually uses', () => {
    const names = extractExportedNames(
      [
        'export declare const Dialog: React.FC;',
        'export declare function useMenu(): void;',
        'export declare class Listbox {}',
        'export interface MenuProps {}',
        'export type Align = "start" | "end";',
        'export { Switch, Tab as Tabs };',
      ].join('\n')
    )
    expect(names).toEqual(expect.arrayContaining(['Dialog', 'useMenu', 'Listbox', 'MenuProps', 'Align', 'Switch']))
    // Renamed exports are known by the name the importer must use.
    expect(names).toContain('Tabs')
    expect(names).not.toContain('Tab')
  })

  it('does not offer `default` as an importable name', () => {
    expect(extractExportedNames('export default function App() {}')).not.toContain('default')
  })
})

describe('readPackageExports', () => {
  it('follows the types field of the package manifest', () => {
    installPackage('@headlessui/react', {
      'package.json': JSON.stringify({ name: '@headlessui/react', types: './dist/types.d.ts' }),
      'dist/types.d.ts': 'export declare const Dialog: unknown;\nexport declare const Menu: unknown;\n',
    })
    const names = readPackageExports(tempDir, '@headlessui/react')
    expect(names).toEqual(['Dialog', 'Menu'])
    // The measured case: the name the model invented is demonstrably not among them.
    expect(names).not.toContain('Card')
  })

  it('falls back to index.d.ts when the manifest declares no types', () => {
    installPackage('some-lib', {
      'package.json': JSON.stringify({ name: 'some-lib' }),
      'index.d.ts': 'export declare function doThing(): void;\n',
    })
    expect(readPackageExports(tempDir, 'some-lib')).toEqual(['doThing'])
  })

  it('answers empty — never a claim — when the package is absent or untyped', () => {
    expect(readPackageExports(tempDir, 'not-installed')).toEqual([])
    installPackage('untyped', { 'package.json': JSON.stringify({ name: 'untyped' }) })
    expect(readPackageExports(tempDir, 'untyped')).toEqual([])
  })

  it('refuses relative specifiers and a missing workspace', () => {
    expect(readPackageExports(tempDir, './local')).toEqual([])
    expect(readPackageExports('', 'react')).toEqual([])
  })

  it('does not follow a types path pointing outside the package', () => {
    installPackage('escapee', {
      'package.json': JSON.stringify({ name: 'escapee', types: '../../../secrets.d.ts' }),
    })
    expect(readPackageExports(tempDir, 'escapee')).toEqual([])
  })
})

describe('readLocalModuleExports', () => {
  it('resolves a relative source module from the importing file', () => {
    const modulePath = path.join(tempDir, 'src', 'components', 'Button.tsx')
    fs.mkdirSync(path.dirname(modulePath), { recursive: true })
    fs.writeFileSync(modulePath, 'export function PrimaryButton() {}\nexport interface ButtonProps {}\n', 'utf-8')

    expect(readLocalModuleExports(tempDir, 'src/App.tsx', './components/Button')).toEqual([
      'PrimaryButton',
      'ButtonProps',
    ])
  })

  it('reports a local default export for import mismatch recovery', () => {
    const modulePath = path.join(tempDir, 'src', 'Button.ts')
    fs.mkdirSync(path.dirname(modulePath), { recursive: true })
    fs.writeFileSync(modulePath, 'const Button = "button"\nexport default Button\n', 'utf-8')

    expect(readLocalModuleExports(tempDir, 'src/App.tsx', './Button')).toEqual(['default'])
  })

  it('does not resolve a relative specifier outside the workspace', () => {
    expect(readLocalModuleExports(tempDir, 'src/App.tsx', '../../outside')).toEqual([])
  })
})
