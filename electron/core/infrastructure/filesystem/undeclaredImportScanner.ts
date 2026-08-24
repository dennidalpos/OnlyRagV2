/**
 * Undeclared Import Scanner.
 *
 * Answers, for the whole workspace and synchronously, the question `importDeclarationGate`
 * already answers for one file: which packages does the code on disk import that package.json
 * never declares?
 *
 * The answer existed and was delivered nowhere it could be acted on. The per-write gate says
 * it once, at the step that wrote the file, inside a tool result that also carries the write's
 * own outcome — in the live run of 2026-08-24 it said it 44 times and the model never acted.
 * `scanWorkspaceDependencies` (depcheck) says it properly, but runs only inside
 * `runProjectVerification`, i.e. at `finish`, which the sessions that need it never reach.
 *
 * Why not simply call depcheck every turn: it is asynchronous, spawns a full project analysis
 * and carries a 60-second timeout. Paying that on each of fifty steps is not a trade this loop
 * can make. This scanner is the cheap half — the same bounded AST walk `generateCompactRepoMap`
 * already performs on every turn — and it reuses `evaluateFileImportIntegrity` verbatim, so
 * "undeclared" means here exactly what it means at write time, with the same deliberate
 * narrowness: a bare specifier, absent from the manifest, not a Node builtin, not a tsconfig
 * alias. depcheck stays where it is, as the thorough check before the session closes.
 */

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

/**
 * Every undeclared package the workspace imports, sorted by name.
 *
 * Returns an empty list — never a partial one presented as complete — when there is no
 * manifest, or when it declares nothing at all: the project is then too early for the question
 * to mean anything, and every import would be reported. That is the same guard the per-file
 * gate applies, and it is what keeps a freshly created workspace from being told its first
 * `import React` is a defect.
 */
export function scanUndeclaredImports(
  workspacePath: string | null | undefined,
  maxFiles = DEFAULT_MAX_FILES
): UndeclaredImport[] {
  if (!workspacePath || !fs.existsSync(workspacePath)) return []

  const declared = agentToolFileRepository.readDeclaredPackages(workspacePath)
  if (!declared || declared.names.size === 0) return []

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
        // Alias prefixes are matched on the specifier as written, before it is reduced to a
        // package name: `~/services/api` reduces to `~`, which matches no prefix and would be
        // reported as a missing package.
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
