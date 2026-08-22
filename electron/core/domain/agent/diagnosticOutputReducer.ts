import stripAnsi from 'strip-ansi'

export interface ExtractedErrorFrame {
  filePath?: string
  lineNumber?: number
  columnNumber?: number
  errorMessage: string
  errorType: string
  rawTrace: string
}

const ERROR_HEADER_REGEX = /(?:Error|Exception|TypeError|ReferenceError|SyntaxError|FAIL|Failed): (.*)/i
const FILE_LINE_REGEX = /(?:at\s+(?:.*?\()|at\s+|in\s+|^|\s)([a-zA-Z]:[\\/][^\s:]+\.(?:ts|tsx|js|jsx|py|json)|[a-zA-Z0-9_./\\-]+\.(?:ts|tsx|js|jsx|py|json)):(\d+)(?::(\d+))?/i

export class DiagnosticOutputReducer {
  public static stripAnsi(text: string): string {
    if (!text) return ''
    return stripAnsi(text)
  }

  /**
   * Distills voluminous terminal output down to high-signal diagnostic headers, error frames, and summary lines.
   */
  public static distillTerminalOutput(output: string, maxChars: number = 2500): string {
    if (!output || typeof output !== 'string') return ''

    const clean = this.stripAnsi(output).trim()
    if (clean.length <= maxChars) return clean

    const lines = clean.split(/\r?\n/)
    const totalLines = lines.length

    const errorPattern = /(?:FAIL|ERROR|Error:|AssertionError|SyntaxError|TypeError|ReferenceError|Exception|failed|UnhandledPromiseRejection|TS\d{4}:|\sat\s|>>>|\berror\b)/i
    const summaryPattern = /(?:Test Files|Tests|Passed|Failed|Duration|Exit code|npm ERR!|error Command failed)/i

    const highlightedLines: string[] = []
    const summaryLines: string[] = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      if (summaryPattern.test(line)) {
        summaryLines.push(line)
      } else if (errorPattern.test(line)) {
        highlightedLines.push(line)
        if (i + 1 < lines.length && lines[i + 1].trim().startsWith('at ')) {
          highlightedLines.push(lines[i + 1].trim())
          i++
        }
      }
    }

    const headLines = lines.slice(0, 5).filter((l) => l.trim().length > 0)
    const tailLines = lines.slice(-5).filter((l) => l.trim().length > 0)

    const distilledParts: string[] = [
      `[TERMINAL OUTPUT DISTILLED: original was ${totalLines} lines / ${clean.length} chars]`,
      '--- HEAD ---',
      ...headLines,
    ]

    if (highlightedLines.length > 0) {
      distilledParts.push('--- RELEVANT DIAGNOSTICS / FAILURES ---')
      distilledParts.push(...highlightedLines.slice(0, 30))
    }

    if (summaryLines.length > 0) {
      distilledParts.push('--- SUMMARY ---')
      distilledParts.push(...summaryLines)
    } else if (tailLines.length > 0) {
      distilledParts.push('--- TAIL ---')
      distilledParts.push(...tailLines)
    }

    const result = distilledParts.join('\n')
    if (result.length > maxChars) {
      return result.slice(0, maxChars) + '\n... [truncated]'
    }
    return result
  }

  /**
   * Extracts exact failing file path and line number from terminal output for small LLM error convergence.
   */
  public static extractErrorDiagnostics(rawTerminalOutput: string): ExtractedErrorFrame | null {
    if (!rawTerminalOutput || !rawTerminalOutput.trim()) return null

    const lines = rawTerminalOutput.split('\n')
    let errorMessage = ''
    let errorType = 'Runtime Error'
    let filePath: string | undefined
    let lineNumber: number | undefined
    let columnNumber: number | undefined

    for (const line of lines) {
      const headerMatch = line.match(ERROR_HEADER_REGEX)
      if (headerMatch && !errorMessage) {
        errorMessage = headerMatch[1].trim()
        const typeMatch = line.match(/([a-zA-Z]+Error|[a-zA-Z]+Exception)/)
        if (typeMatch) errorType = typeMatch[1]
      }

      const fileMatch = line.match(FILE_LINE_REGEX)
      if (fileMatch && !filePath) {
        filePath = fileMatch[1]
        lineNumber = parseInt(fileMatch[2], 10)
        if (fileMatch[3]) columnNumber = parseInt(fileMatch[3], 10)
      }
    }

    if (!errorMessage && !filePath) {
      return null
    }

    return {
      filePath,
      lineNumber,
      columnNumber,
      errorMessage: errorMessage || 'Terminal command failed',
      errorType,
      rawTrace: lines.slice(-25).join('\n'),
    }
  }

  public static formatDiagnosticPrompt(frame: ExtractedErrorFrame): string {
    const locStr = frame.filePath ? `At ${frame.filePath}${frame.lineNumber ? `:${frame.lineNumber}` : ''}` : 'Location unknown'
    return `[TARGETED ERROR DIAGNOSTIC FOR SMALL LLM CONVERGENCE]
Type: ${frame.errorType}
Location: ${locStr}
Message: ${frame.errorMessage}

Relevant Terminal Tail Stack Trace:
\`\`\`
${frame.rawTrace}
\`\`\`
DIRECTIVE: Fix the exact error at ${locStr} using replace_file_content or write_file.`
  }
}

export const extractErrorDiagnostics = DiagnosticOutputReducer.extractErrorDiagnostics
export const formatDiagnosticPrompt = DiagnosticOutputReducer.formatDiagnosticPrompt
