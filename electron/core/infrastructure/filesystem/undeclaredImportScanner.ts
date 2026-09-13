

import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_IGNORED_DIRS, isSecretFile } from '../../domain/agent/contextFilter'
import { extractBareImportSpecifiers, packageNameOfSpecifier } from '../../domain/agent/importDeclarationGate'
import { agentToolFileRepository } from './agentToolFileRepository'

/** The extensions `extractBareImportSpecifiers` understands; anything else yields nothing. */
const SCANNABLE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

/** Same ceiling as the repo map, for the same reason: a bounded cost paid once per turn. */
const DEFAULT_MAX_FILES = 150
const MAX_DEPTH = 5

/** A package the code imports and the manifest does not declare. */
export interface UndeclaredImport {
  packageName: string
  /** Workspace-relative paths that import it, sorted, at most a handful. */
  importedBy: string[]
}

/** Every undeclared package the workspace imports, sorted by name. */
export function scanUndeclaredImports(
  workspacePath: string | null | undefined,
  maxFiles = DEFAULT_MAX_FILES
): UndeclaredImport[] {
  if (!workspacePath || !fs.existsSync(workspacePath)) return []

  const declared = agentToolFileRepository.readDeclaredPackages(workspacePath)
  if (!declared) return []

  const aliasPrefixes = declared.aliasPrefixes || []
  const byPackage = new Map<string, Set<string>>()
  let scanned = 0

  const visit = (dir: string, depth: number) => {
    if (depth > MAX_DEPTH || scanned >= maxFiles) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (scanned >= maxFiles) return
      if (DEFAULT_IGNORED_DIRS.has(entry.name) || isSecretFile(entry.name)) continue
      const full = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        visit(full, depth + 1)
        continue
      }
      if (!SCANNABLE.has(path.extname(entry.name).toLowerCase())) continue

      scanned++
      let content: string
      try {
        content = fs.readFileSync(full, 'utf-8')
      } catch {
        continue
      }

      const relative = path.relative(workspacePath, full).replace(/\\/g, '/')
      for (const specifier of extractBareImportSpecifiers(relative, content)) {
        // Alias prefixes are matched on the specifier as written, before it is reduced to a package name: `~/services/api` reduces to `~`, which matches no prefix and would be reported as a missing package.
        if (aliasPrefixes.some((prefix) => prefix && specifier.startsWith(prefix))) continue
        const pkg = packageNameOfSpecifier(specifier)
        if (declared.names.has(pkg)) continue
        const files = byPackage.get(pkg) ?? new Set<string>()
        files.add(relative)
        byPackage.set(pkg, files)
      }
    }
  }

  visit(workspacePath, 0)

  return Array.from(byPackage.entries())
    .map(([packageName, files]) => ({ packageName, importedBy: Array.from(files).sort() }))
    .sort((a, b) => a.packageName.localeCompare(b.packageName))
}
