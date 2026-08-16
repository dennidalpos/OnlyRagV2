import * as ts from 'typescript'
import * as path from 'node:path'

export interface ASTValidationResult {
  isValid: boolean
  syntaxError?: string
  line?: number
  character?: number
}

export interface FuzzyReplaceResult {
  success: boolean
  updatedContent?: string
  error?: string
  confidenceScore: number
}

export class FuzzyPatchEngineWithASTValidator {
  /**
   * Normalizes line endings to LF to prevent Windows/Unix CRLF mismatch failures.
   */
  private static normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  }

  /**
   * Calculates normalized Levenshtein similarity distance between two string chunks.
   */
  private static calculateSimilarity(a: string, b: string): number {
    const s1 = a.trim()
    const s2 = b.trim()
    if (s1 === s2) return 1.0
    if (s1.length === 0 || s2.length === 0) return 0.0

    const matrix: number[][] = []
    for (let i = 0; i <= s1.length; i++) {
      matrix[i] = [i]
    }
    for (let j = 0; j <= s2.length; j++) {
      matrix[0][j] = j
    }

    for (let i = 1; i <= s1.length; i++) {
      for (let j = 1; j <= s2.length; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        )
      }
    }

    const maxLength = Math.max(s1.length, s2.length)
    return 1 - matrix[s1.length][s2.length] / maxLength
  }

  /**
   * Applies fuzzy chunk replacement with whitespace tolerance and sliding window matching.
   */
  public static applyFuzzyReplace(
    fileContent: string,
    targetContent: string,
    replacementContent: string,
    minSimilarityThreshold = 0.82
  ): FuzzyReplaceResult {
    const normalizedFile = this.normalizeLineEndings(fileContent)
    const normalizedTarget = this.normalizeLineEndings(targetContent)
    const normalizedReplacement = this.normalizeLineEndings(replacementContent)

    // 1. Exact string match fast path
    if (normalizedFile.includes(normalizedTarget)) {
      const updated = normalizedFile.replace(normalizedTarget, normalizedReplacement)
      return { success: true, updatedContent: updated, confidenceScore: 1.0 }
    }

    // 2. Sliding window line-matching for fuzzy whitespace/indentation drift
    const fileLines = normalizedFile.split('\n')
    const targetLines = normalizedTarget.split('\n')
    const targetLineCount = targetLines.length

    let bestMatchIndex = -1
    let maxSimilarity = 0

    for (let i = 0; i <= fileLines.length - targetLineCount; i++) {
      const candidateChunk = fileLines.slice(i, i + targetLineCount).join('\n')
      const similarity = this.calculateSimilarity(candidateChunk, normalizedTarget)

      if (similarity > maxSimilarity) {
        maxSimilarity = similarity
        bestMatchIndex = i
      }
    }

    if (maxSimilarity >= minSimilarityThreshold && bestMatchIndex !== -1) {
      const beforeLines = fileLines.slice(0, bestMatchIndex)
      const afterLines = fileLines.slice(bestMatchIndex + targetLineCount)
      const updatedLines = [...beforeLines, normalizedReplacement, ...afterLines]

      return {
        success: true,
        updatedContent: updatedLines.join('\n'),
        confidenceScore: maxSimilarity,
      }
    }

    return {
      success: false,
      confidenceScore: maxSimilarity,
      error: `Fuzzy patch failed: Best match similarity was ${(maxSimilarity * 100).toFixed(1)}% (Required >= ${minSimilarityThreshold * 100}%). Verify target content snippet.`,
    }
  }

  /**
   * Performs in-flight AST syntax validation before file persistence.
   */
  public static validateAST(filePath: string, content: string): ASTValidationResult {
    const ext = path.extname(filePath).toLowerCase()

    if (['.ts', '.tsx', '.js', '.jsx', '.json'].includes(ext)) {
      if (ext === '.json') {
        try {
          JSON.parse(content)
          return { isValid: true }
        } catch (err: any) {
          return { isValid: false, syntaxError: `JSON Syntax Error: ${err.message}` }
        }
      }

      const scriptKind = ext === '.tsx' || ext === '.jsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true,
        scriptKind
      )

      const diagnostics = (sourceFile as any).parseDiagnostics || []
      if (diagnostics.length > 0) {
        const firstErr = diagnostics[0]
        const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, firstErr.start || 0)
        const messageText =
          typeof firstErr.messageText === 'string'
            ? firstErr.messageText
            : firstErr.messageText.messageText
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
}
