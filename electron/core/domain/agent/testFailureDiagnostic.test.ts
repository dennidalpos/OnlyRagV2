import { describe, expect, it } from 'vitest'
import { buildTestFailureDirective, extractFailingTest } from './testFailureDiagnostic'
import { buildDiagnosticFixDirective, diagnosticFixTargetFile } from './compilerDiagnosticDirective'

/** The Jest output of the full-task run of 2026-09-24 (run 6), ANSI colours included. */
const JEST_OUTPUT = [
  '> project-dashboard-task@1.0.0 test',
  '> react-scripts test',
  'FAIL src/App.test.jsx (6.143 s)',
  '  × renders correctly (8 ms)',
  '  ● renders correctly',
  '    expect(received).toContain(expected) // indexOf',
  '    Expected substring: "<div class=\\"bg-white\\">"',
  '    Received string:    "<div class=\\"min-h-screen bg-gray-100\\"><h1>Project Dashboard Task</h1></div>"',
  '    \u001b[0m \u001b[90m 6 |\u001b[39m test(',
].join('\n')

describe('extractFailingTest', () => {
  it('names the failing test file and the runner’s own expected/received lines', () => {
    const failing = extractFailingTest(JEST_OUTPUT)

    expect(failing?.file).toBe('src/App.test.jsx')
    expect(failing?.expected).toBe('"<div class=\\"bg-white\\">"')
    expect(failing?.received).toContain('Project Dashboard Task')
  })

  it('reads the Vitest spelling too', () => {
    expect(extractFailingTest(' FAIL  src/app.test.ts > app > renders\nAssertionError: expected 1 to be 2')?.file).toBe('src/app.test.ts')
  })

  it('is not fooled by a build error', () => {
    expect(extractFailingTest("src/App.tsx(3,1): error TS2304: Cannot find name 'x'.")).toBeNull()
  })
})

describe('a failing test is diagnosed like a compiler error', () => {
  it('orders one rewrite of the test file, carrying the received value', () => {
    const directive = buildDiagnosticFixDirective(JEST_OUTPUT)!

    expect(directive).toContain('MUST be "write_file" on "src/App.test.jsx"')
    expect(directive).toContain('Received: ')
    expect(directive.split('\n').filter((line) => /^\d+\. /.test(line))).toHaveLength(2)
    expect(diagnosticFixTargetFile(JEST_OUTPUT)).toBe('src/App.test.jsx')
  })

  it('omits evidence lines the runner did not print', () => {
    expect(buildTestFailureDirective({ file: 'src/a.test.js', kind: 'assertion', expected: null, received: null })).not.toContain('Received:')
  })
})

describe('a test file that never loaded is not an assertion failure', () => {
  /** The Vitest output of full-task run 8, 2026-09-24. */
  const VITEST_LOAD_FAILURE = [
    ' ❯ src/App.test.jsx (0 test)',
    ' Test Files  1 failed (1)',
    '⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯',
    ' FAIL  src/App.test.jsx [ src/App.test.jsx ]',
    'Error: Failed to resolve import "../App" from "src/App.test.jsx". Does the file exist?',
    ' ❯ src/App.test.jsx:4:1',
    "      3| import { renderToString } from 'react-dom/server';",
    "      4| import App from '../App';",
    '       | ^',
  ].join('\n')

  it('reports the load failure with the line the runner pointed at', () => {
    const failing = extractFailingTest(VITEST_LOAD_FAILURE)

    expect(failing).toMatchObject({ file: 'src/App.test.jsx', kind: 'load', loadLine: { line: 4, source: "import App from '../App';" } })
  })

  it('orders the import fixed instead of the assertion rewritten', () => {
    const directive = buildDiagnosticFixDirective(VITEST_LOAD_FAILURE)!

    expect(directive).toContain('[THE TEST FILE DID NOT LOAD — "src/App.test.jsx" line 4]')
    expect(directive).toContain("The runner stopped at: import App from '../App';")
    expect(directive).not.toContain('ASSERTION')
  })
})
