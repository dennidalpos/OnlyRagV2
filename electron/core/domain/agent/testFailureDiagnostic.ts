/** Reads a failing Jest/Vitest/node:test run the way compilerDiagnosticDirective reads tsc: which file, which assertion. */

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI colour codes are exactly what is stripped here.
const ANSI = /\u001b\[[0-9;]*m/g
const TEST_FILE = /(?:^|\s)(?:FAIL|×|✕|❯)\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\b/m
/** Vitest: "Failed Suites" / "(0 test)"; Jest: "Test suite failed to run". Nothing in the file ran. */
const SUITE_DID_NOT_LOAD = /Failed Suites|\(0 tests?\)|Test suite failed to run/i
const MAX_EVIDENCE_CHARS = 400

export interface FailingTest {
  /** Workspace-relative path of the test file the runner reported as failing. */
  file: string
  /** 'load': the file never ran (e.g. an import that does not resolve); 'assertion': a test ran and failed. */
  kind: 'load' | 'assertion'
  /** The source line the runner pointed at when the file did not load. */
  loadLine?: { line: number; source: string }
  /** The runner's own expected/received lines, bounded, or null when it printed none. */
  expected: string | null
  received: string | null
}

function evidenceLine(text: string, label: RegExp): string | null {
  const match = label.exec(text)
  if (!match) return null
  const value = match[1].trim()
  return value.length > MAX_EVIDENCE_CHARS ? `${value.slice(0, MAX_EVIDENCE_CHARS)}…` : value
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The code-frame line the runner pointed at: "❯ file:line:col" (Vitest) or "> line |" (Jest). */
function pointedSourceLine(text: string, file: string): { line: number; source: string } | undefined {
  const at = new RegExp(`${escapeRegExp(file)}:(\\d+)`).exec(text)
  const line = Number(at?.[1] ?? /^\s*>\s*(\d+)\s*\|/m.exec(text)?.[1])
  if (!Number.isInteger(line) || line <= 0) return undefined
  const source = new RegExp(`^\\s*>?\\s*${line}\\s*\\|(.*)$`, 'm').exec(text)?.[1]?.trim()
  return source ? { line, source } : undefined
}

/** The failing test file and why it failed, or null when the output is not a failing test run. */
export function extractFailingTest(output: string): FailingTest | null {
  const text = (output || '').replace(ANSI, '')
  const raw = TEST_FILE.exec(text)?.[1]
  if (!raw) return null
  const file = raw.replace(/\\/g, '/').replace(/^\.\//, '')
  const didNotLoad = SUITE_DID_NOT_LOAD.test(text)
  return {
    file,
    kind: didNotLoad ? 'load' : 'assertion',
    loadLine: didNotLoad ? pointedSourceLine(text, file) : undefined,
    expected: evidenceLine(text, /^\s*Expected(?: substring| value)?:\s*(.+)$/m),
    received: evidenceLine(text, /^\s*Received(?: string| value)?:\s*(.+)$/m),
  }
}

/** One instruction for a failing test: fix the import that kept it from loading, or the assertion that disagrees with the code. */
export function buildTestFailureDirective(failing: FailingTest): string {
  if (failing.kind === 'load') {
    return [
      `[THE TEST FILE DID NOT LOAD — "${failing.file}"${failing.loadLine ? ` line ${failing.loadLine.line}` : ''}]`,
      ...(failing.loadLine ? [`The runner stopped at: ${failing.loadLine.source}`] : []),
      `No test ran: the file failed before its first test, which is almost always an import that does not resolve. A relative import is resolved from the folder of "${failing.file}", so a file in that same folder is imported as "./Name", not "../Name".`,
      `Directives:`,
      `1. Your next tool call MUST be "write_file" on "${failing.file}", with the complete file and that import pointing at a file that exists.`,
      `2. Do NOT run the test again before a file has changed.`,
    ].join('\n')
  }
  return [
    `[THE TEST RAN AND ITS ASSERTION FAILED — "${failing.file}"]`,
    ...(failing.expected ? [`Expected: ${failing.expected}`] : []),
    ...(failing.received ? [`Received: ${failing.received}`] : []),
    `The runner, the dependencies and the script all work: only the assertion disagrees with what the code produced. Running the test again cannot change that.`,
    `Directives:`,
    `1. Your next tool call MUST be "write_file" on "${failing.file}", with the complete test rewritten so that it asserts content the code really produces${failing.received ? ' (the Received value above)' : ''}. If that output shows the application itself is broken (empty, or an error), fix the application file instead.`,
    `2. Do NOT run the test again before a file has changed.`,
  ].join('\n')
}
