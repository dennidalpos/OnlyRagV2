import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { scriptKindForPath } from './sourceScriptKind'

describe('scriptKindForPath', () => {
  it('parses JavaScript files in JS mode, where JSX is legal', () => {
    expect(scriptKindForPath('src/App.js')).toBe(ts.ScriptKind.JS)
    expect(scriptKindForPath('vite.config.MJS')).toBe(ts.ScriptKind.JS)
    expect(scriptKindForPath('server.cjs')).toBe(ts.ScriptKind.JS)
    expect(scriptKindForPath('src/App.jsx')).toBe(ts.ScriptKind.JSX)
  })

  it('keeps .ts free of JSX and .tsx in TSX mode', () => {
    expect(scriptKindForPath('src/util.ts')).toBe(ts.ScriptKind.TS)
    expect(scriptKindForPath('src/App.tsx')).toBe(ts.ScriptKind.TSX)
  })
})
