import path from 'node:path'
import fs from 'node:fs'
import ts from 'typescript'

interface CachedProgram {
  configMtimeMs: number
  program: ts.Program
}

/** Message Main posts to the typecheck worker (electron/typecheckWorker.ts). */
export interface TypecheckRequest {
  id: number
  workspacePath: string
  filePath: string
}

/** Worker reply: the diagnostic block, or null when the file is clean or not checked. */
export interface TypecheckResponse {
  id: number
  diagnostic: string | null
}

const MAX_CACHED_WORKSPACES = 8
const TYPECHECKED_SOURCE = /\.(?:[cm]?ts|tsx|jsx?)$/i

export function isTypecheckedSource(filePath: string): boolean {
  return TYPECHECKED_SOURCE.test(filePath)
}

/**
 * Reuses TypeScript's previous Program for successive writes in one workspace. The check is
 * synchronous, so Main runs it on a worker thread through WorkspaceTypecheckWorkerClient.
 */
export class WorkspaceIncrementalTypecheck {
  private readonly cache = new Map<string, CachedProgram>()

  checkWrittenFile(workspacePath: string, absoluteFilePath: string): string | null {
    if (!isTypecheckedSource(absoluteFilePath)) return null

    const configPath = path.join(workspacePath, 'tsconfig.json')
    if (!fs.existsSync(configPath)) return null

    try {
      const configMtimeMs = fs.statSync(configPath).mtimeMs
      const config = ts.readConfigFile(configPath, ts.sys.readFile)
      if (config.error) return null

      const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, workspacePath, { noEmit: true }, configPath)
      const normalizedTarget = path.resolve(absoluteFilePath)
      if (!parsed.fileNames.some((fileName) => path.resolve(fileName) === normalizedTarget)) return null

      const previous = this.cache.get(workspacePath)
      const program = ts.createProgram({
        rootNames: parsed.fileNames,
        options: parsed.options,
        projectReferences: parsed.projectReferences,
        oldProgram: previous?.configMtimeMs === configMtimeMs ? previous.program : undefined,
      })
      this.remember(workspacePath, { configMtimeMs, program })

      const source = program.getSourceFile(normalizedTarget)
      if (!source) return null
      const diagnostics = [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)]
      if (diagnostics.length === 0) return null

      return this.formatDiagnostics(workspacePath, diagnostics.slice(0, 5))
    } catch {
      // This is advisory feedback after a successful disk write. A checker failure must not
      // misreport that persisted write as failed; the ordinary verification gate remains final.
      return null
    }
  }

  private remember(workspacePath: string, cached: CachedProgram): void {
    this.cache.delete(workspacePath)
    this.cache.set(workspacePath, cached)
    if (this.cache.size <= MAX_CACHED_WORKSPACES) return
    const oldest = this.cache.keys().next().value
    if (oldest) this.cache.delete(oldest)
  }

  private formatDiagnostics(workspacePath: string, diagnostics: readonly ts.Diagnostic[]): string {
    const lines = diagnostics.map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
      if (!diagnostic.file || diagnostic.start === undefined) return `TS${diagnostic.code}: ${message}`
      const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      const relativePath = path.relative(workspacePath, diagnostic.file.fileName).replace(/\\/g, '/')
      return `${relativePath}(${position.line + 1},${position.character + 1}): error TS${diagnostic.code}: ${message}`
    })

    return `\n\n[POST-WRITE TYPECHECK DIAGNOSTIC]\n${lines.join('\n')}\nThe file was written, but it does not typecheck. Correct the diagnostic before rewriting other files.`
  }
}
