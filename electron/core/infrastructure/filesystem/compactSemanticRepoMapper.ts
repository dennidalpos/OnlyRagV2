/**
 * electron/core/infrastructure/filesystem/compactSemanticRepoMapper.ts
 *
 * Infrastructure Layer — AST-aware repository scanner and compact repo map generator.
 * Walks workspace filesystem, extracts exported AST declarations using the TypeScript Compiler API,
 * and builds a compact repo map for agent context budgeting.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as ts from 'typescript'
import { DEFAULT_IGNORED_DIRS, isSecretFile } from '../../domain/agent/contextFilter'

export interface SymbolSummary {
  name: string
  kind: 'class' | 'function' | 'interface' | 'type'
  exported: boolean
}

/**
 * Extract AST symbols from a TypeScript/JavaScript source file.
 */
function extractFileSymbols(filePath: string): SymbolSummary[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true)
    const symbols: SymbolSummary[] = []

    const visit = (node: ts.Node) => {
      if (ts.isClassDeclaration(node) && node.name) {
        symbols.push({
          name: node.name.text,
          kind: 'class',
          exported: Boolean(node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)),
        })
      } else if (ts.isFunctionDeclaration(node) && node.name) {
        symbols.push({
          name: node.name.text,
          kind: 'function',
          exported: Boolean(node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)),
        })
      } else if (ts.isInterfaceDeclaration(node)) {
        symbols.push({
          name: node.name.text,
          kind: 'interface',
          exported: Boolean(node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)),
        })
      } else if (ts.isTypeAliasDeclaration(node)) {
        symbols.push({
          name: node.name.text,
          kind: 'type',
          exported: Boolean(node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)),
        })
      }
      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
    return symbols
  } catch {
    return []
  }
}

/**
 * Generate a compact AST-aware repo map for system prompt context budgeting.
 */
export function generateCompactRepoMap(workspacePath: string, maxFiles = 100): string {
  const lines: string[] = []

  const scanDir = (dir: string, depth = 0) => {
    if (depth > 5 || lines.length >= maxFiles) return
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })

      for (const entry of entries) {
        if (DEFAULT_IGNORED_DIRS.has(entry.name) || isSecretFile(entry.name)) continue
        const fullPath = path.join(dir, entry.name)
        const relPath = path.relative(workspacePath, fullPath).replace(/\\/g, '/')

        if (entry.isDirectory()) {
          scanDir(fullPath, depth + 1)
        } else {
          const ext = path.extname(entry.name).toLowerCase()
          if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
            const symbols = extractFileSymbols(fullPath)
            if (symbols.length > 0) {
              const symStr = symbols
                .map((s) => `${s.exported ? 'export ' : ''}${s.kind} ${s.name}`)
                .join(', ')
              lines.push(`📄 ${relPath} ➔ { ${symStr} }`)
            } else {
              lines.push(`📄 ${relPath}`)
            }
          } else {
            lines.push(`📄 ${relPath}`)
          }
        }
      }
    } catch {}
  }

  if (fs.existsSync(workspacePath)) {
    scanDir(workspacePath)
  }

  return lines.join('\n')
}
