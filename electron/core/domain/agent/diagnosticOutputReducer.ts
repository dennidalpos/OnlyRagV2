export class DiagnosticOutputReducer {
  private static readonly ANSI_REGEX = /\u001b\[[0-9;]*[a-zA-Z]/g

  public static stripAnsi(text: string): string {
    if (!text) return ''
    return text.replace(this.ANSI_REGEX, '')
  }

  public static distillTerminalOutput(output: string, maxChars: number = 2500): string {
    if (!output || typeof output !== 'string') return ''

    const clean = this.stripAnsi(output).trim()
    if (clean.length <= maxChars) return clean

    const lines = clean.split(/\r?\n/)
    const totalLines = lines.length

    // Critical diagnostic patterns to prioritize
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
        // Grab next 2 lines for stack trace context if available
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
}
