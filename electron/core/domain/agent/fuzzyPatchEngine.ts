import * as ts from 'typescript'
import * as path from 'node:path'
import { scriptKindForPath } from './sourceScriptKind'
import { errorMessage } from '../../../../shared/domain/errors/errorMessage'

export interface ASTValidationResult {
  isValid: boolean
  syntaxError?: string
  line?: number
  character?: number
}

/**
 * JSON files whose tools read them as JSON with comments (tsconfig, jsconfig, VS Code settings, dev
 * containers). Strict JSON.parse rejected every valid tsconfig.json that carried a comment.
 */
function isJsoncFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase()
  const base = path.basename(normalized)
  return (
    base.endsWith('.jsonc') ||
    /^(?:tsconfig|jsconfig)(?:\..*)?\.json$/.test(base) ||
    base === 'devcontainer.json' ||
    base === '.devcontainer.json' ||
    normalized.includes('/.vscode/') ||
    normalized.startsWith('.vscode/')
  )
}

function validateJsonc(filePath: string, content: string): ASTValidationResult {
  const sourceFile = ts.parseJsonText(filePath, content) as ts.JsonSourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }
  const first = sourceFile.parseDiagnostics?.[0]
  if (!first) return { isValid: true }
  const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, first.start || 0)
  const messageText = typeof first.messageText === 'string' ? first.messageText : first.messageText.messageText
  return { isValid: false, syntaxError: `JSON Syntax Error: ${messageText}`, line: line + 1, character: character + 1 }
}

/**
 * Performs in-flight AST syntax validation before file persistence.
 */
export function validateAST(filePath: string, content: string): ASTValidationResult {
  const ext = path.extname(filePath).toLowerCase()

  if (['.ts', '.tsx', '.js', '.jsx', '.json', '.jsonc'].includes(ext)) {
    if (isJsoncFile(filePath)) return validateJsonc(filePath, content)
    if (ext === '.json') {
      try {
        JSON.parse(content.replace(/^\uFEFF/, ''))
        return { isValid: true }
      } catch (err: unknown) {
        return { isValid: false, syntaxError: `JSON Syntax Error: ${errorMessage(err)}` }
      }
    }

    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKindForPath(filePath))

    const sourceWithDiags = sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }
    const diagnostics = sourceWithDiags.parseDiagnostics || []
    if (diagnostics.length > 0) {
      const firstErr = diagnostics[0]
      const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, firstErr.start || 0)
      const messageText = typeof firstErr.messageText === 'string' ? firstErr.messageText : firstErr.messageText.messageText
      return {
        isValid: false,
        syntaxError: `AST Syntax Error: ${messageText}`,
        line: line + 1,
        character: character + 1,
      }
    }
  }

  return { isValid: true }
}
