/**
 * electron/core/infrastructure/filesystem/packageExportScanner.ts
 *
 * Infrastructure Layer — what a package actually exports, read from its own type declarations.
 *
 * `TS2305: Module '"@headlessui/react"' has no exported member 'Card'` tells the model that the
 * name it invented is not there. It does not tell it which names ARE, and a 7B model has no way
 * to find out: it never calls `read_file` (0 calls across five live runs against 95 write_file),
 * and even if it did, it would have to know to look inside node_modules for a .d.ts.
 *
 * Measured 2026-08-25T19:59, session live-full-task, steps 42-43: the build reported that
 * `@headlessui/react` exports neither `Card` nor `List`; the directive ordered TaskCard.tsx
 * rewritten; the model rewrote it with the identical import. It was not ignoring the directive —
 * it had nothing to replace the names with.
 *
 * Blueprint §6.2.1: the answer is on disk, so the system reads it and hands it over.
 *
 * Deliberately regex-based rather than a TypeScript program. This feeds one sentence of a
 * directive: a name list that is nearly complete is worth far more than the seconds a real
 * type-checker pass would cost on every failing build, and a miss degrades to the directive
 * saying less, never to it saying something false.
 */

import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../../../diagnostics'

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

/**
 * What `packageName` exports inside this workspace, or an empty array when it cannot be read.
 *
 * Empty is a normal answer — the package may be absent, untyped, or shaped in a way the patterns
 * miss — and callers must treat it as "say nothing about the exports" rather than as "it exports
 * nothing", which would be a claim the scanner has not earned.
 */
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
    return extractExportedNames(fs.readFileSync(sourcePath, 'utf-8')).slice(0, MAX_NAMES)
  } catch (err: any) {
    logger.log('WARN', 'PackageExportScanner', `Could not read local exports for ${specifier}: ${err.message}`)
    return []
  }
}
