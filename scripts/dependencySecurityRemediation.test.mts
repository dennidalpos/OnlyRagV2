import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'package.json'))
const depcheckRequire = createRequire(require.resolve('depcheck'))
const findupRequire = createRequire(depcheckRequire.resolve('findup-sync'))
const matchRequire = createRequire(findupRequire.resolve('micromatch'))
interface Ast {
  type: string
  nodes: Ast[]
  value?: string
}
interface Braces {
  (pattern: string | string[], options?: Record<string, unknown>): string[]
  parse(pattern: string, options?: Record<string, unknown>): Ast
  compile(input: string | Ast): string
  expand(input: string | Ast): string[]
  stringify(input: string | Ast): string
}
const braces = matchRequire('braces') as Braces

it('resolves the security fork through the real depcheck dependency chain', () => {
  expect(matchRequire('braces/package.json')).toMatchObject({ name: 'braces', version: '3.0.4+onlyrag.1', private: true })
  expect(fs.readFileSync(matchRequire.resolve('braces'), 'utf8')).toBe(fs.readFileSync(path.join(root, 'vendor/braces-3.0.4/index.js'), 'utf8'))
})

it('retains upstream bytes for the unchanged entry point, utilities, constants and license', () => {
  const provenance = JSON.parse(fs.readFileSync(path.join(root, 'vendor/braces-3.0.4/UPSTREAM.json'), 'utf8')) as {
    originalFiles: { path: string; sha256: string }[]
  }
  for (const name of ['index.js', 'LICENSE', 'lib/constants.js', 'lib/utils.js']) {
    const original = provenance.originalFiles.find((file) => file.path === name)
    expect(original, name).toBeDefined()
    expect(
      createHash('sha256')
        .update(fs.readFileSync(path.join(root, 'vendor/braces-3.0.4', name)))
        .digest('hex'),
    ).toBe(original?.sha256)
  }
})

it('preserves ordinary patterns, nested alternatives, ranges, escaping and duplicate removal', () => {
  expect(braces('src/{a,b}.ts')).toEqual(['src/(a|b).ts'])
  expect(braces.expand('src/{a,{b,c}}.ts')).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
  expect(braces.expand('v{1..3}')).toEqual(['v1', 'v2', 'v3'])
  expect(braces.expand('v{03..01}')).toEqual(['v03', 'v02', 'v01'])
  expect(braces(['{a,b}', '{b,c}'], { expand: true, nodupes: true })).toEqual(['a', 'b', 'c'])
  expect(braces.stringify(braces.parse('a/\\{b,c\\}/d'))).toBe('a/{b,c}/d')
})

it.each(['compile', 'expand', 'stringify'] as const)('rejects deeply nested brace input before %s recursion', (method) => {
  const payload = '{'.repeat(4000) + 'a,b' + '}'.repeat(4000)
  expect(() => braces[method](payload)).toThrow(expect.objectContaining({ code: 'ERR_BRACES_DEPTH', name: 'SyntaxError' }))
})

it.each(['{', '('])('rejects deep or unterminated %s parser frames even with permissive caller options', (opener) => {
  expect(() => braces.parse(opener.repeat(10000), { maxDepth: Infinity, maxLength: Infinity })).toThrow(expect.objectContaining({ code: 'ERR_BRACES_DEPTH' }))
})

it.each(['compile', 'expand', 'stringify'] as const)('bounds caller-supplied ASTs before the %s walker', (method) => {
  let ast: Ast = { type: 'text', value: 'leaf', nodes: [] }
  for (let index = 0; index < 10000; index++) ast = { type: 'root', nodes: [ast] }
  expect(() => braces[method](ast)).toThrow(expect.objectContaining({ code: 'ERR_BRACES_DEPTH', name: 'SyntaxError' }))
})

it.each(['compile', 'expand', 'stringify'] as const)('rejects cyclic caller ASTs before %s recursion', (method) => {
  const ast: Ast = { type: 'root', nodes: [] }
  ast.nodes.push(ast)
  expect(() => braces[method](ast)).toThrow(expect.objectContaining({ code: 'ERR_BRACES_DEPTH' }))
})

it('bounds wide caller ASTs without building an unbounded traversal queue', () => {
  const ast: Ast = { type: 'root', nodes: Array.from({ length: 131073 }, () => ({ type: 'text', value: 'a', nodes: [] })) }
  expect(() => braces.compile(ast)).toThrow('maximum node count')
})

it('removes every sprintf-js installation from the lock and retains the replacement parent APIs', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')) as { packages: Record<string, unknown> }
  expect(Object.keys(lock.packages).filter((key) => /(?:^|\/)node_modules\/sprintf-js$/.test(key))).toEqual([])
  const yamlRequire = createRequire(depcheckRequire.resolve('js-yaml'))
  expect(yamlRequire('argparse/package.json').version).toBe('2.0.1')
  expect(typeof yamlRequire('argparse').ArgumentParser).toBe('function')
  const electronBuilderRequire = createRequire(require.resolve('electron-builder/package.json'))
  const builderRequire = createRequire(electronBuilderRequire.resolve('app-builder-lib'))
  const getRequire = createRequire(builderRequire.resolve('@electron/get'))
  expect(getRequire('global-agent/package.json').version).toBe('4.1.3')
  expect(typeof getRequire('global-agent').bootstrap).toBe('function')
})
