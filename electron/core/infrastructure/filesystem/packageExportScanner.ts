import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../logging/logger'

/** Declaration files above this are re-export barrels or bundled monsters; neither repays reading further. */
const MAX_DECLARATION_BYTES = 512 * 1024
/** Enough for the model to choose from; a longer list stops being readable and starts being noise. */
const MAX_NAMES = 40

const EXPORT_PATTERNS: RegExp[] = [
  // export declare const X / function X / class X / let X / var X / enum X
  /export\s+declare\s+(?:abstract\s+)?(?:const|function|class|let|var|enum)\s+([A-Za-z_$][\w$]*)/g,
  // export interface X / type X / const X / function X / class X / enum X
  /export\s+(?:interface|type|const|function|class|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/g,
]
/** `export { A, B as C }` — the exported name is what follows `as` when there is one. */
const EXPORT_LIST = /export\s*\{([^}]*)\}/g

function declarationEntryPoint(packageRoot: string): string | null {
  const manifestPath = path.join(packageRoot, 'package.json')
  try {
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
      const declared = manifest.types || manifest.typings
      if (typeof declared === 'string') {
        const resolved = path.resolve(packageRoot, declared)
        if (resolved.startsWith(path.resolve(packageRoot)) && fs.existsSync(resolved)) return resolved
      }
    }
  } catch {
    // A malformed manifest is not worth failing a build diagnostic over.
  }
  for (const candidate of ['index.d.ts', 'dist/index.d.ts', 'types/index.d.ts', 'lib/index.d.ts']) {
    const resolved = path.join(packageRoot, ...candidate.split('/'))
    if (fs.existsSync(resolved)) return resolved
  }
  return null
}

/** The names a declaration file exports, in source order, deduplicated. */
export function extractExportedNames(declarationSource: string): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const add = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === 'default' || seen.has(trimmed)) return
    seen.add(trimmed)
    found.push(trimmed)
  }

  for (const pattern of EXPORT_PATTERNS) {
    for (const match of declarationSource.matchAll(pattern)) add(match[1])
  }
  for (const match of declarationSource.matchAll(EXPORT_LIST)) {
    for (const entry of match[1].split(',')) {
      const parts = entry.split(/\s+as\s+/)
      add(parts[parts.length - 1].replace(/\btype\b/, ''))
    }
  }

  return found
}

/** What `packageName` exports inside this workspace, or an empty array when it cannot be read. */
export function readPackageExports(workspacePath: string, packageName: string): string[] {
  if (!workspacePath || !packageName || packageName.startsWith('.')) return []
  try {
    const packageRoot = path.join(workspacePath, 'node_modules', ...packageName.split('/'))
    if (!fs.existsSync(packageRoot)) return []

    const entryPoint = declarationEntryPoint(packageRoot)
    if (!entryPoint) return []
    if (fs.statSync(entryPoint).size > MAX_DECLARATION_BYTES) return []

    return extractExportedNames(fs.readFileSync(entryPoint, 'utf-8')).slice(0, MAX_NAMES)
  } catch (err: any) {
    logger.log('WARN', 'PackageExportScanner', `Could not read exports of ${packageName}: ${err.message}`)
    return []
  }
}

/** Export names from the local module named by a relative import in a compiler diagnostic. */
export function readLocalModuleExports(workspacePath: string, importingFile: string, specifier: string): string[] {
  if (!workspacePath || !importingFile || !specifier.startsWith('.')) return []
  try {
    const workspaceRoot = path.resolve(workspacePath)
    const base = path.resolve(workspaceRoot, path.dirname(importingFile), specifier)
    const candidates = [
      base,
      ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'].map((extension) => `${base}${extension}`),
      ...['index.ts', 'index.tsx', 'index.js', 'index.jsx'].map((fileName) => path.join(base, fileName)),
    ]
    const sourcePath = candidates.find((candidate) => {
      const relative = path.relative(workspaceRoot, candidate)
      return relative && !relative.startsWith('..') && !path.isAbsolute(relative) && fs.existsSync(candidate)
    })
    if (!sourcePath || fs.statSync(sourcePath).size > MAX_DECLARATION_BYTES) return []
    const source = fs.readFileSync(sourcePath, 'utf-8')
    const names = extractExportedNames(source)
    if (/\bexport\s+default\b/.test(source)) names.unshift('default')
    return names.slice(0, MAX_NAMES)
  } catch (err: any) {
    logger.log('WARN', 'PackageExportScanner', `Could not read local exports for ${specifier}: ${err.message}`)
    return []
  }
}
