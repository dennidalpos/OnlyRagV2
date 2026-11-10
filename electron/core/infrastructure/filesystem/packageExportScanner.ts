import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../logging/logger'
import { errorMessage } from '../../../../shared/domain/errors/errorMessage'

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

/** True when the installed package declares a stylesheet entry, so `@import "<package>"` resolves. */
export function packageHasStyleEntry(workspacePath: string, packageName: string): boolean {
  if (!workspacePath || !packageName || packageName.startsWith('.')) return false
  try {
    const manifestPath = path.join(workspacePath, 'node_modules', ...packageName.split('/'), 'package.json')
    if (!fs.existsSync(manifestPath)) return false
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    const rootExport = manifest.exports?.['.']
    return typeof manifest.style === 'string' || (typeof rootExport === 'object' && rootExport !== null && 'style' in rootExport)
  } catch {
    return false
  }
}

/** True when an installed package provides the `name` command (`node_modules/.bin/<name>`, `.cmd` on Windows). */
export function isBinaryInstalled(workspacePath: string, name: string): boolean {
  if (!workspacePath || !name || /[\\/]/.test(name)) return false
  const bin = path.join(workspacePath, 'node_modules', '.bin', name)
  return fs.existsSync(bin) || fs.existsSync(`${bin}.cmd`)
}

/** The workspace-relative form of `filePath` when it lies inside the workspace, else `filePath` unchanged. */
export function toWorkspaceRelativePath(workspacePath: string, filePath: string): string {
  if (!workspacePath || !path.isAbsolute(filePath)) return filePath
  const relative = path.relative(path.resolve(workspacePath), path.resolve(filePath))
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative.replace(/\\/g, '/') : filePath
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
  } catch (err: unknown) {
    logger.log('WARN', 'PackageExportScanner', `Could not read exports of ${packageName}: ${errorMessage(err)}`)
    return []
  }
}

function isInsideWorkspace(workspaceRoot: string, candidate: string): boolean {
  const relative = path.relative(workspaceRoot, candidate)
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

/** A workspace file's text, or null when it is outside the workspace, missing, not a file or too large. */
export function readWorkspaceTextFile(workspacePath: string, relativePath: string): string | null {
  if (!workspacePath || !relativePath) return null
  try {
    const workspaceRoot = path.resolve(workspacePath)
    const filePath = path.resolve(workspaceRoot, relativePath)
    if (!isInsideWorkspace(workspaceRoot, filePath) || !fs.existsSync(filePath)) return null
    const stat = fs.statSync(filePath)
    return stat.isFile() && stat.size <= MAX_DECLARATION_BYTES ? fs.readFileSync(filePath, 'utf-8') : null
  } catch {
    return null
  }
}

/** The source of the local module a relative import from `importingFile` resolves to, or null. */
export function readLocalModuleSource(workspacePath: string, importingFile: string, specifier: string): string | null {
  if (!workspacePath || !importingFile || !specifier.startsWith('.')) return null
  const workspaceRoot = path.resolve(workspacePath)
  const base = path.resolve(workspaceRoot, path.dirname(importingFile), specifier)
  const candidates = [
    base,
    ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'].map((extension) => `${base}${extension}`),
    ...['index.ts', 'index.tsx', 'index.js', 'index.jsx'].map((fileName) => path.join(base, fileName)),
  ]
  for (const candidate of candidates) {
    if (!isInsideWorkspace(workspaceRoot, candidate)) continue
    const source = readWorkspaceTextFile(workspaceRoot, path.relative(workspaceRoot, candidate))
    if (source !== null) return source
  }
  return null
}

/** Export names from the local module named by a relative import in a compiler diagnostic. */
export function readLocalModuleExports(workspacePath: string, importingFile: string, specifier: string): string[] {
  if (!workspacePath || !importingFile || !specifier.startsWith('.')) return []
  try {
    const source = readLocalModuleSource(workspacePath, importingFile, specifier)
    if (source === null) return []
    const names = extractExportedNames(source)
    if (/\bexport\s+default\b/.test(source)) names.unshift('default')
    return names.slice(0, MAX_NAMES)
  } catch (err: unknown) {
    logger.log('WARN', 'PackageExportScanner', `Could not read local exports for ${specifier}: ${errorMessage(err)}`)
    return []
  }
}
