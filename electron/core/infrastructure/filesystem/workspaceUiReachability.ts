import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import type { PlanMilestone } from '../../../../shared/types'
import { resolveDeclaredFilePaths } from '../../../../shared/domain/agent/milestoneDeliverableResolver'
import { CONVENTIONAL_ENTRY_PATHS, extractLocalScriptSources } from '../../domain/agent/entrypointIntegrity'

const MODULE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.cts', '.cjs']

function referencedModules(filePath: string): string[] {
  const source = ts.createSourceFile(filePath, fs.readFileSync(filePath, 'utf-8'), ts.ScriptTarget.Latest, true)
  const imports: string[] = []
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text)
    }
    if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
        imports.push(node.arguments[0].text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return imports.filter((specifier) => specifier.startsWith('.'))
}

/** Statically follows local module references from the HTML entrypoint. */
export function reachableUiModules(workspacePath: string): Set<string> | null {
  const root = path.resolve(workspacePath)
  const htmlPath = path.join(root, 'index.html')
  if (!fs.existsSync(htmlPath)) return null
  const scripts = extractLocalScriptSources(fs.readFileSync(htmlPath, 'utf-8'))
  const entries = scripts.map((script) => path.resolve(root, script.replace(/^\//, ''))).filter((entry) => fs.existsSync(entry))
  if (entries.length === 0) {
    const fallback = CONVENTIONAL_ENTRY_PATHS.map((entry) => path.join(root, entry)).find((entry) => fs.existsSync(entry))
    if (!fallback) return null
    entries.push(fallback)
  }

  const reached = new Set<string>()
  const queue = [...entries]
  while (queue.length > 0 && reached.size < 2_000) {
    const current = queue.shift()!
    const relative = path.relative(root, current).replace(/\\/g, '/').toLowerCase()
    if (relative.startsWith('..') || reached.has(relative)) continue
    reached.add(relative)
    for (const specifier of referencedModules(current)) {
      const resolved = ts.resolveModuleName(specifier, current, { moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true }, ts.sys).resolvedModule
        ?.resolvedFileName
      if (resolved && MODULE_EXTENSIONS.includes(path.extname(resolved).toLowerCase())) queue.push(resolved)
    }
  }
  return reached.size >= 2_000 ? null : reached
}

/** Names page/layout modules that exist but are not loaded by the application. */
export function unreachableUiDeliverables(workspacePath: string, milestone: Pick<PlanMilestone, 'title' | 'filePaths'>): string[] {
  const declared = resolveDeclaredFilePaths(milestone).filter(
    (file) => /^src\/(?:pages|components)\//i.test(file) && MODULE_EXTENSIONS.includes(path.extname(file).toLowerCase()),
  )
  if (declared.length === 0) return []
  const reached = reachableUiModules(workspacePath)
  if (!reached) return []
  return declared.filter((file) => {
    const direct = path.resolve(workspacePath, file)
    if (fs.existsSync(direct)) return !reached.has(file.toLowerCase())
    const extension = path.extname(file)
    const stem = file.slice(0, -extension.length)
    const aliases = MODULE_EXTENSIONS.map((candidate) => `${stem}${candidate}`).filter((candidate) => fs.existsSync(path.resolve(workspacePath, candidate)))
    return aliases.length !== 1 || !reached.has(aliases[0].toLowerCase())
  })
}
