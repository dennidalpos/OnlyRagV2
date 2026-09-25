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
 * Performs in-flight AST syntax validation before file persistence.
 */
export function validateAST(filePath: string, content: string): ASTValidationResult {
  const ext = path.extname(filePath).toLowerCase()

  if (['.ts', '.tsx', '.js', '.jsx', '.json'].includes(ext)) {
    if (ext === '.json') {
      try {
        JSON.parse(content)
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
