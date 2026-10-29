import * as path from 'node:path'
import * as ts from 'typescript'

/**
 * Parser mode for a source file, chosen as tsc and the bundlers choose it: JSX is legal in
 * `.js`, `.jsx` and `.tsx` (Create React App and many Vite templates keep JSX in `.js`) and
 * never in `.ts`, where `<T>x` is a type assertion.
 */
export function scriptKindForPath(filePath: string): ts.ScriptKind {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.tsx') return ts.ScriptKind.TSX
  if (ext === '.jsx') return ts.ScriptKind.JSX
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}
