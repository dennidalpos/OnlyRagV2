import path from 'node:path'
import fs from 'node:fs'
import * as ts from 'typescript'
import { logger } from '../../../diagnostics'
import { isIgnoredPath, validatePathSafety as domainValidatePathSafety } from '../../domain/agent/contextFilter'
import { MAX_FILE_READ_BYTES } from '../../domain/agent/ioLimits'

export function validatePathSafety(filePath?: string | null, workspaceRoot?: string | null): string | null {
  const result = domainValidatePathSafety(filePath, workspaceRoot)
  if (!result.safePath) {
    if (result.error) {
      logger.log('WARN', 'WorkspaceRepo', `Path safety validation rejected '${filePath}': ${result.error}`)
    }
    return null
  }
  return result.safePath
}

export class FileSystemRepository {
  async listFiles(targetPath: string) {
    const rootDir = validatePathSafety(targetPath)
    if (!rootDir) return []

    try {
      if (!fs.existsSync(rootDir) || !(await fs.promises.stat(rootDir)).isDirectory()) {
        return []
      }
      const entries = await fs.promises.readdir(rootDir, { withFileTypes: true })
      const result = []

      for (const entry of entries) {
        if (isIgnoredPath(entry.name, entry.isDirectory())) continue
        const fullPath = path.join(rootDir, entry.name)
        let sizeBytes = 0
        if (!entry.isDirectory()) {
          try {
            const st = await fs.promises.stat(fullPath)
            sizeBytes = st.size
          } catch (stErr: any) {
            logger.log('WARN', 'WorkspaceRepo', `Could not stat file '${fullPath}': ${stErr.message}`)
          }
        }
        result.push({
          name: entry.name,
          path: fullPath,
          isDir: entry.isDirectory(),
          sizeBytes,
        })
      }

      return result
    } catch (err: any) {
      logger.log('ERROR', 'WorkspaceRepo', `Error listing files: ${err.message}`)
      return []
    }
  }

  async getProjectMap(dirPath: string) {
    const rootDir = validatePathSafety(dirPath)
    if (!rootDir) return []

    try {
      const st = await fs.promises.stat(rootDir)
      if (!st.isDirectory()) return []
    } catch (err: any) {
      logger.log('WARN', 'WorkspaceRepo', `Directory stat failed for '${dirPath}': ${err.message}`)
      return []
    }

    const safeRootDir = rootDir
    const mapItems: { path: string; relativePath: string; isDir: boolean; sizeBytes: number }[] = []
    const MAX_ITEMS = 10000

    async function scanAsync(currentDir: string, depth: number) {
      if (depth > 12 || mapItems.length >= MAX_ITEMS) return
      try {
        const entries = await fs.promises.readdir(currentDir, { withFileTypes: true })
        for (const entry of entries) {
          if (mapItems.length >= MAX_ITEMS) break
          if (isIgnoredPath(entry.name, entry.isDirectory())) continue

          const fullPath = path.join(currentDir, entry.name)
          const relPath = path.relative(safeRootDir, fullPath).replace(/\\/g, '/')

          if (entry.isDirectory()) {
            mapItems.push({ path: fullPath, relativePath: relPath + '/', isDir: true, sizeBytes: 0 })
            await scanAsync(fullPath, depth + 1)
          } else {
            let size = 0
            try {
              const fileStat = await fs.promises.stat(fullPath)
              size = fileStat.size
            } catch (statErr: any) {
              logger.log('WARN', 'WorkspaceRepo', `Stat error on ${fullPath}: ${statErr.message}`)
            }
            mapItems.push({ path: fullPath, relativePath: relPath, isDir: false, sizeBytes: size })
          }
        }
      } catch (err: any) {
        logger.log('WARN', 'WorkspaceRepo', `Scan skipped on ${currentDir}: ${err.message}`)
      }
    }

    await scanAsync(safeRootDir, 0)
    return mapItems
  }

  async readFile(
    filePath: string,
    startLine?: number,
    endLine?: number
  ): Promise<{ success: boolean; content?: string; totalLines?: number; startLine?: number; endLine?: number; error?: string }> {
    const resolved = validatePathSafety(filePath)
    if (!resolved) return { success: false, error: 'Invalid file path' }

    try {
      if (!fs.existsSync(resolved) || !(await fs.promises.stat(resolved)).isFile()) {
        return { success: false, error: 'File not found or invalid target' }
      }

      const stats = await fs.promises.stat(resolved)
      if (stats.size > MAX_FILE_READ_BYTES) {
        return {
          success: false,
          error: `File size exceeds ${MAX_FILE_READ_BYTES / (1024 * 1024)}MB limit (${(stats.size / (1024 * 1024)).toFixed(1)}MB). Select a smaller file for editor preview.`,
        }
      }

      const rawContent = await fs.promises.readFile(resolved, 'utf-8')
      const lines = rawContent.split(/\r?\n/)
      const totalLines = lines.length

      if (startLine !== undefined || endLine !== undefined) {
        const s = Math.max(1, startLine || 1)
        const e = Math.min(totalLines, endLine || totalLines)
        const slicedLines = lines.slice(s - 1, e)
        const formattedSlice = slicedLines
          .map((line, idx) => `${s + idx}: ${line}`)
          .join('\n')
        return { success: true, content: formattedSlice, totalLines, startLine: s, endLine: e }
      }

      return { success: true, content: rawContent, totalLines }
    } catch (err: any) {
      logger.log('ERROR', 'WorkspaceRepo', `Error reading file '${filePath}': ${err.message}`)
      return { success: false, error: err.message }
    }
  }

  async deleteFile(filePath: string): Promise<{ success: boolean; error?: string }> {
    const resolved = validatePathSafety(filePath)
    if (!resolved) return { success: false, error: 'Invalid file path' }

    try {
      if (!fs.existsSync(resolved)) {
        return { success: false, error: 'File does not exist' }
      }
      const stat = await fs.promises.stat(resolved)
      if (stat.isDirectory()) {
        await fs.promises.rm(resolved, { recursive: true, force: true })
      } else {
        await fs.promises.unlink(resolved)
      }
      logger.log('INFO', 'WorkspaceRepo', `Deleted: ${resolved}`)
      return { success: true }
    } catch (err: any) {
      logger.log('ERROR', 'WorkspaceRepo', `Failed to delete ${filePath}: ${err.message}`)
      return { success: false, error: err.message }
    }
  }

  async writeFile(filePath: string, content: string): Promise<{ success: boolean; error?: string }> {
    const resolved = validatePathSafety(filePath)
    if (!resolved) return { success: false, error: 'Invalid file path' }

    try {
      await fs.promises.mkdir(path.dirname(resolved), { recursive: true })
      await fs.promises.writeFile(resolved, content, 'utf-8')
      logger.log('INFO', 'WorkspaceRepo', `Wrote to file: ${resolved}`)
      return { success: true }
    } catch (err: any) {
      logger.log('ERROR', 'WorkspaceRepo', `Failed to write file ${filePath}: ${err.message}`)
      return { success: false, error: err.message }
    }
  }

  async replaceChunk(
    filePath: string,
    targetContent: string,
    replacementContent: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.multiReplaceChunks(filePath, [{ targetContent, replacementContent }])
  }

  async multiReplaceChunks(
    filePath: string,
    replacements: { targetContent: string; replacementContent: string }[]
  ): Promise<{ success: boolean; replacedCount?: number; error?: string }> {
    const resolved = validatePathSafety(filePath)
    if (!resolved) return { success: false, error: 'Invalid file path' }

    try {
      if (!fs.existsSync(resolved)) {
        return { success: false, error: 'File does not exist' }
      }
      let existing = await fs.promises.readFile(resolved, 'utf-8')
      const hadCrlf = existing.includes('\r\n')
      let replacedCount = 0

      for (let idx = 0; idx < replacements.length; idx++) {
        const { targetContent, replacementContent } = replacements[idx]
        if (!targetContent) continue

        if (existing.includes(targetContent)) {
          existing = existing.replace(targetContent, replacementContent)
          replacedCount++
        } else {
          // Normalize CRLF to LF and retry fuzzy replacement
          const normExisting = existing.replace(/\r\n/g, '\n')
          const normTarget = targetContent.replace(/\r\n/g, '\n')
          const normReplacement = replacementContent.replace(/\r\n/g, '\n')

          if (normExisting.includes(normTarget)) {
            existing = normExisting.replace(normTarget, normReplacement)
            replacedCount++
          } else {
            return {
              success: false,
              replacedCount,
              error: `Chunk #${idx + 1} target content was not found in file: "${targetContent.slice(0, 120)}..."`,
            }
          }
        }
      }

      // Preserve original CRLF line endings if the original file had them
      if (hadCrlf && !existing.includes('\r\n')) {
        existing = existing.replace(/\n/g, '\r\n')
      }

      await fs.promises.writeFile(resolved, existing, 'utf-8')
      logger.log('INFO', 'WorkspaceRepo', `Successfully applied ${replacedCount} chunk replacement(s) in: ${resolved}`)
      return { success: true, replacedCount }
    } catch (err: any) {
      logger.log('ERROR', 'WorkspaceRepo', `Failed replacing chunk(s) in ${filePath}: ${err.message}`)
      return { success: false, error: err.message }
    }
  }

  async grepSearch(
    dirPath: string,
    query: string,
    isRegex?: boolean,
    caseInsensitive?: boolean
  ): Promise<{ filePath: string; relativePath: string; lineNumber: number; lineContent: string }[]> {
    const rootDir = validatePathSafety(dirPath)
    if (!rootDir || !fs.existsSync(rootDir)) return []
    const safeRootDir = rootDir

    const IGNORED_NAMES = new Set(['.git', 'node_modules', 'dist', 'dist-electron', '.venv', 'build', 'sidecar_dist', '__pycache__'])
    const BINARY_EXTENSIONS = new Set([
      '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz',
      '.exe', '.dll', '.so', '.dylib', '.pyc', '.db', '.sqlite', '.bin', '.dat',
      '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4', '.mov', '.avi'
    ])
    const results: { filePath: string; relativePath: string; lineNumber: number; lineContent: string }[] = []
    const MAX_MATCHES = 1000

    let matcher: (line: string) => boolean
    if (isRegex) {
      try {
        const flags = caseInsensitive ? 'i' : ''
        const regex = new RegExp(query, flags)
        matcher = (line: string) => regex.test(line)
      } catch (regErr: any) {
        logger.log('WARN', 'WorkspaceRepo', `Invalid regex pattern '${query}': ${regErr.message}`)
        return []
      }
    } else {
      const q = caseInsensitive ? query.toLowerCase() : query
      matcher = (line: string) => (caseInsensitive ? line.toLowerCase().includes(q) : line.includes(q))
    }

    async function searchDir(currentDir: string, depth: number) {
      if (depth > 12 || results.length >= MAX_MATCHES) return
      try {
        const entries = await fs.promises.readdir(currentDir, { withFileTypes: true })
        for (const entry of entries) {
          if (results.length >= MAX_MATCHES) break
          if (IGNORED_NAMES.has(entry.name)) continue

          const fullPath = path.join(currentDir, entry.name)
          if (entry.isDirectory()) {
            await searchDir(fullPath, depth + 1)
          } else {
            try {
              const ext = path.extname(entry.name).toLowerCase()
              if (BINARY_EXTENSIONS.has(ext)) continue

              const stat = await fs.promises.stat(fullPath)
              if (stat.size > 10 * 1024 * 1024) continue

              const content = await fs.promises.readFile(fullPath, 'utf-8')
              const lines = content.split('\n')
              const relPath = path.relative(safeRootDir, fullPath).replace(/\\/g, '/')

              for (let i = 0; i < lines.length; i++) {
                if (results.length >= MAX_MATCHES) break
                if (matcher(lines[i])) {
                  results.push({
                    filePath: fullPath,
                    relativePath: relPath,
                    lineNumber: i + 1,
                    lineContent: lines[i].trim().slice(0, 300),
                  })
                }
              }
            } catch (readErr: any) {
              logger.log('WARN', 'WorkspaceRepo', `Grep read failed on '${fullPath}': ${readErr.message}`)
            }
          }
        }
      } catch (dirErr: any) {
        logger.log('WARN', 'WorkspaceRepo', `Grep search directory error on '${currentDir}': ${dirErr.message}`)
      }
    }

    await searchDir(rootDir, 0)
    return results
  }

  async extractCodeSymbols(
    filePath: string,
    filterKind?: string
  ): Promise<{ success: boolean; symbols?: CodeSymbolItem[]; totalCount?: number; error?: string }> {
    const resolved = validatePathSafety(filePath)
    if (!resolved) return { success: false, error: 'Invalid file path' }

    try {
      if (!fs.existsSync(resolved) || !(await fs.promises.stat(resolved)).isFile()) {
        return { success: false, error: 'File not found or invalid target' }
      }

      const rawContent = await fs.promises.readFile(resolved, 'utf-8')
      const ext = path.extname(resolved).toLowerCase()
      const symbols: CodeSymbolItem[] = []
      const normFilter = filterKind ? filterKind.toLowerCase().trim() : null

      if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
        const sourceFile = ts.createSourceFile(
          resolved,
          rawContent,
          ts.ScriptTarget.Latest,
          true,
          ext === '.tsx' || ext === '.jsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS
        )

        const visit = (node: ts.Node) => {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          const lineNum = line + 1

          if (ts.isFunctionDeclaration(node) && node.name) {
            const firstLine = node.getText(sourceFile).split(/\r?\n/)[0].trim()
            symbols.push({ name: node.name.text, kind: 'function', startLine: lineNum, signature: firstLine.slice(0, 160) })
          } else if (ts.isClassDeclaration(node) && node.name) {
            const firstLine = node.getText(sourceFile).split(/\r?\n/)[0].trim()
            symbols.push({ name: node.name.text, kind: 'class', startLine: lineNum, signature: firstLine.slice(0, 160) })
          } else if (ts.isInterfaceDeclaration(node) && node.name) {
            const firstLine = node.getText(sourceFile).split(/\r?\n/)[0].trim()
            symbols.push({ name: node.name.text, kind: 'interface', startLine: lineNum, signature: firstLine.slice(0, 160) })
          } else if (ts.isTypeAliasDeclaration(node) && node.name) {
            const firstLine = node.getText(sourceFile).split(/\r?\n/)[0].trim()
            symbols.push({ name: node.name.text, kind: 'type', startLine: lineNum, signature: firstLine.slice(0, 160) })
          } else if (ts.isEnumDeclaration(node) && node.name) {
            const firstLine = node.getText(sourceFile).split(/\r?\n/)[0].trim()
            symbols.push({ name: node.name.text, kind: 'enum', startLine: lineNum, signature: firstLine.slice(0, 160) })
          } else if (ts.isVariableStatement(node)) {
            for (const decl of node.declarationList.declarations) {
              if (
                ts.isIdentifier(decl.name) &&
                decl.initializer &&
                (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
              ) {
                const firstLine = node.getText(sourceFile).split(/\r?\n/)[0].trim()
                symbols.push({ name: decl.name.text, kind: 'function', startLine: lineNum, signature: firstLine.slice(0, 160) })
              }
            }
          }

          ts.forEachChild(node, visit)
        }

        visit(sourceFile)
      } else {
        const lines = rawContent.split(/\r?\n/)
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) {
            continue
          }

          const lineNum = i + 1

          if (ext === '.py') {
            const pyClassMatch = line.match(/^\s*class\s+([a-zA-Z0-9_]+)/)
            if (pyClassMatch) {
              symbols.push({ name: pyClassMatch[1], kind: 'class', startLine: lineNum, signature: trimmed.slice(0, 160) })
              continue
            }

            const pyDefMatch = line.match(/^\s*(?:async\s+)?def\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/)
            if (pyDefMatch) {
              const isMethod = line.startsWith('    ') || line.startsWith('\t')
              symbols.push({ name: pyDefMatch[1], kind: isMethod ? 'method' : 'function', startLine: lineNum, signature: trimmed.slice(0, 160) })
              continue
            }
          } else if (['.go', '.rs', '.c', '.cpp', '.h', '.hpp', '.cs', '.java'].includes(ext)) {
            const genClassMatch = line.match(/(?:class|struct|interface|trait|enum)\s+([a-zA-Z0-9_]+)/)
            if (genClassMatch) {
              symbols.push({ name: genClassMatch[1], kind: 'class', startLine: lineNum, signature: trimmed.slice(0, 160) })
              continue
            }

            const genFnMatch = line.match(/(?:func|fn|def|void|int|string|bool|async|public|private)\s+([a-zA-Z0-9_]+)\s*\(/)
            if (genFnMatch) {
              symbols.push({ name: genFnMatch[1], kind: 'function', startLine: lineNum, signature: trimmed.slice(0, 160) })
              continue
            }
          }
        }
      }

      const filtered = normFilter && normFilter !== 'all'
        ? symbols.filter((s) => s.kind === normFilter)
        : symbols

      return {
        success: true,
        symbols: filtered,
        totalCount: filtered.length,
      }
    } catch (err: any) {
      logger.log('ERROR', 'WorkspaceRepo', `Error extracting code symbols from '${filePath}': ${err.message}`)
      return { success: false, error: err.message }
    }
  }
}

export interface CodeSymbolItem {
  name: string
  kind: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'method'
  startLine: number
  signature: string
}
