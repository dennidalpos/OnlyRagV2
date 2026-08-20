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

/**
 * AST & Regex-aware Stack Trace Extractor: Parses terminal output to isolate exact failing files and line numbers
 * so small local models receive zero-clutter error diagnostics.
 */
export function extractErrorDiagnostics(rawTerminalOutput: string): ExtractedErrorFrame | null {
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

/**
 * Formats extracted error diagnostic for prompt injection.
 */
export function formatDiagnosticPrompt(frame: ExtractedErrorFrame): string {
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
