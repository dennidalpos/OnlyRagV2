import { describe, expect, it } from 'vitest'
import { buildTestFailureDirective, extractFailingTest, isTestFilePath, literalJsxText, renderedTextFragment, testedModuleText } from './testFailureDiagnostic'
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

describe('load failures carry the exact fix when it is computable', () => {
  const UNRESOLVED = [
    '> vitest run',
    ' ❯ src/App.test.jsx (0 test)',
    '⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯',
    ' FAIL  src/App.test.jsx [ src/App.test.jsx ]',
    'Error: Failed to resolve import "../App" from "src/App.test.jsx". Does the file exist?',
    ' ❯ src/App.test.jsx:4:1',
    "      4| import App from '../App';",
    '       | ^',
  ].join('\n')

  /** Full task run 12 of 2026-09-24: vitest without globals, the frame pointing at `describe(`. */
  const MISSING_GLOBAL = [
    '> vitest run',
    ' ❯ src/App.test.jsx (0 test)',
    '⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯',
    ' FAIL  src/App.test.jsx [ src/App.test.jsx ]',
    'ReferenceError: describe is not defined',
    ' ❯ src/App.test.jsx:7:1',
    "      7| describe('Project Dashboard Task', () => {",
    '       | ^',
  ].join('\n')

  it('names the specifier that resolves and the exact replacement line', () => {
    const resolves = (_file: string, specifier: string) => specifier === './App'
    const directive = buildTestFailureDirective(extractFailingTest(UNRESOLVED)!, resolves)

    expect(directive).toContain('"../App" does not resolve from "src/App.test.jsx"; "./App" does')
    expect(directive).toContain(`replaced by exactly: import App from './App';`)
  })

  it('keeps the generic advice when no nearby module resolves', () => {
    const directive = buildTestFailureDirective(extractFailingTest(UNRESOLVED)!, () => false)

    expect(directive).toContain('almost always an import that does not resolve')
  })

  it('orders the vitest import for describe/it/expect instead of blaming an import', () => {
    const failing = extractFailingTest(MISSING_GLOBAL)!
    const directive = buildTestFailureDirective(failing)

    expect(failing).toMatchObject({ kind: 'load', missingGlobal: 'describe', runner: 'vitest' })
    expect(directive).toContain(`exact first line added: import { describe, it, expect } from 'vitest'`)
    expect(directive).not.toContain('almost always an import')
  })

  it('reads the global from the code frame when the message was lost', () => {
    const failing = extractFailingTest(MISSING_GLOBAL.replace('ReferenceError: describe is not defined', 'ReferenceError: [details redacted]'))

    expect(failing?.missingGlobal).toBe('describe')
  })

  it('is wired into the compiler diagnostic directive with the local module resolver', () => {
    const directive = buildDiagnosticFixDirective(UNRESOLVED, undefined, (_file, specifier) => (specifier === './App' ? ['default'] : []))!

    expect(directive).toContain(`import App from './App';`)
  })
})

describe('a test file with no test in it', () => {
  /** Full task run 13 of 2026-09-24: `const testApp = () => { expect(...) }; export default testApp`. */
  const NO_TEST = [
    '> vitest run',
    ' ❯ src/App.test.jsx (0 test)',
    '⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯',
    ' FAIL  src/App.test.jsx [ src/App.test.jsx ]',
    'Error: No test suite found in file D:/work/src/App.test.jsx',
  ].join('\n')

  it('orders the assertions wrapped in it() instead of blaming an import', () => {
    const failing = extractFailingTest(NO_TEST)!
    const directive = buildTestFailureDirective(failing)

    expect(failing).toMatchObject({ kind: 'load', declaresNoTest: true })
    expect(failing.unresolvedImport).toBeUndefined()
    expect(directive).toContain("it('renders the app', () => { ... })")
    expect(directive).toContain("import { describe, it, expect } from 'vitest'")
    expect(directive).not.toContain('almost always an import')
  })
})

describe('an assertion failure carries the corrected assertion', () => {
  /** Full task run 14 of 2026-09-24 (react-scripts/Jest), colours stripped. */
  const JEST_ASSERTION = [
    '> react-scripts test',
    'FAIL src/App.test.jsx',
    '  App Component',
    '    × renders correctly (10 ms)',
    '  ● App Component › renders correctly',
    '    expect(received).toContain(expected) // indexOf',
    '    Expected substring: "<div class=\\"bg-white\\">"',
    '    Received string:    "<div class=\\"flex h-screen\\"><aside class=\\"bg-gray-800\\"><h1>Project Dashboard</h1><nav></nav></aside></div>"',
    '    >  9 |     expect(html).toContain(\'<div class="bg-white">\');',
    '      at Object.<anonymous> (src/App.test.jsx:9:18)',
  ].join('\n')

  it('finds visible text in the rendered output', () => {
    expect(renderedTextFragment('"<div class=\\"x\\"><h1>Project Dashboard</h1></div>"')).toBe('Project Dashboard')
    expect(renderedTextFragment('"<div></div>"')).toBeNull()
    expect(renderedTextFragment(null)).toBeNull()
  })

  it('states the exact replacement for the failing line', () => {
    const failing = extractFailingTest(JEST_ASSERTION)!
    const directive = buildTestFailureDirective(failing)

    expect(failing).toMatchObject({ kind: 'assertion', loadLine: { line: 9 } })
    expect(directive).toContain('line 9]')
    expect(directive).toContain(`(and any comment after it) replaced by exactly: expect(html).toContain('Project Dashboard');`)
  })

  it('suggests an assertion on rendered text when the failing line is not a toContain', () => {
    const directive = buildTestFailureDirective({
      file: 'src/App.test.jsx',
      kind: 'assertion',
      loadLine: { line: 9, source: 'expect(html).toBe(expected);' },
      expected: '"x"',
      received: '"<main><p>Tasks</p></main>"',
    })

    expect(directive).toContain(`e.g. expect(html).toContain('Tasks')`)
  })
})

describe('a name the running test never imported', () => {
  /** Full task run 19 of 2026-09-24: the test ran, and threw before its assertion. */
  const RUNNING_REFERENCE_ERROR = [
    '> vitest run',
    ' ❯ src/App.test.jsx (1 test | 1 failed) 5ms',
    ' FAIL  src/App.test.jsx > App > renders correctly',
    'ReferenceError: renderToString is not defined',
    ' ❯ src/App.test.jsx:7:18',
    '      7|     const html = renderToString(<App />);',
  ].join('\n')

  it('orders the exact import instead of an assertion rewrite', () => {
    const failing = extractFailingTest(RUNNING_REFERENCE_ERROR)!
    const directive = buildTestFailureDirective(failing)

    expect(failing).toMatchObject({ kind: 'assertion', undefinedName: 'renderToString' })
    expect(directive).toContain(`this exact line added after the other imports: import { renderToString } from 'react-dom/server'`)
    expect(directive).not.toContain('ASSERTION FAILED')
  })

  it('names the missing import generically for an unknown name', () => {
    const directive = buildTestFailureDirective(extractFailingTest(RUNNING_REFERENCE_ERROR.replace(/renderToString is/, 'formatTask is'))!)

    expect(directive).toContain('the import that provides "formatTask" added at the top')
  })
})

describe('isTestFilePath', () => {
  it('recognises test and spec files only', () => {
    expect(isTestFilePath('src/App.test.jsx')).toBe(true)
    expect(isTestFilePath('src\\api.spec.ts')).toBe(true)
    expect(isTestFilePath('src/App.jsx')).toBe(false)
    expect(isTestFilePath('src/testing/App.jsx')).toBe(false)
    expect(isTestFilePath(undefined)).toBe(false)
  })
})

describe('a code frame cut short by the runner', () => {
  it('drops the trailing comment from the line it orders replaced', () => {
    const directive = buildTestFailureDirective({
      file: 'src/App.test.jsx',
      kind: 'assertion',
      loadLine: { line: 10, source: `expect(html).toContain('<div class="bg-white">'); // Example asser…` },
      expected: '"<div class="bg-white">"',
      received: '"<div><h1>Project Dashboard Task</h1></div>"',
    })

    expect(directive).toContain(
      `the line "expect(html).toContain('<div class="bg-white">');" (and any comment after it) replaced by exactly: expect(html).toContain('Project Dashboard Task');`,
    )
  })
})

describe('a test global missing inside a test that ran', () => {
  it('orders the vitest import, not an assertion rewrite', () => {
    const output = [
      '> vitest run',
      ' ❯ src/App.test.jsx (1 test | 1 failed) 5ms',
      ' FAIL  src/App.test.jsx > App > renders',
      'ReferenceError: expect is not defined',
      ' ❯ src/App.test.jsx:8:5',
      "      8|     expect(html).toContain('Tasks');",
    ].join('\n')
    const directive = buildTestFailureDirective(extractFailingTest(output)!)

    expect(directive).toContain(`import { describe, it, expect } from 'vitest'`)
    expect(directive).not.toContain('ASSERTION FAILED')
  })
})

describe('the Vitest 0.x one-line assertion message', () => {
  /** Full task run 26 of 2026-09-24: Vitest 0.26 printed chai's message with the received value cut at 40 characters. */
  const output = [
    '> vitest run',
    ' FAIL  src/App.test.jsx > App > renders the dashboard title',
    `AssertionError: expected '<div class="min-h-screen flex"><aside…' to include 'Project Dashboard'`,
    ' ❯ src/App.test.jsx:8:18',
    "      8|     expect(html).toContain('Project Dashboard')",
    '       |                  ^',
  ].join('\n')

  it('reads expected and received from the message and marks the received value cut short', () => {
    const failing = extractFailingTest(output)!
    expect(failing.kind).toBe('assertion')
    expect(failing.expected).toBe('Project Dashboard')
    expect(failing.received).toBe('<div class="min-h-screen flex"><aside…')
    expect(failing.receivedTruncated).toBe(true)
  })

  it('rewrites the assertion on literal text of the module the test renders', () => {
    const files: Record<string, string> = {
      'src/App.test.jsx': "import { renderToString } from 'react-dom/server'\nimport './index.css'\nimport App from './App'\n",
      'src/App.jsx':
        'export default function App() {\n  return (\n    <div className="min-h-screen flex">\n      <aside>{links}</aside>\n      <h1 className="text-2xl">\n        Projects overview\n      </h1>\n    </div>\n  )\n}\n',
    }
    const readFile = (relativePath: string) => files[relativePath] ?? null
    const readModule = (_importingFile: string, specifier: string) => (specifier === './App' ? files['src/App.jsx'] : null)
    expect(testedModuleText('src/App.test.jsx', readFile, readModule)).toEqual({ text: 'Projects overview', module: './App' })

    const directive = buildDiagnosticFixDirective(output, undefined, undefined, { readWorkspaceFile: readFile, readLocalModuleSource: readModule })!
    expect(directive).toContain('Received (cut short by the runner)')
    expect(directive).toContain(`"./App", which the test renders, contains the literal text 'Projects overview'.`)
    expect(directive).toContain(`replaced by exactly: expect(html).toContain('Projects overview')`)
  })

  it('keeps the generic rewrite advice when no module text can be read', () => {
    const directive = buildTestFailureDirective(extractFailingTest(output)!)
    expect(directive).toContain('asserts content the code really produces')
  })
})

describe('literalJsxText', () => {
  it('skips expressions, code and quoted text', () => {
    expect(literalJsxText('const a = useState<string>(null)\nreturn <p>{count}</p>')).toBeNull()
    expect(literalJsxText("<span>Don't</span><li>Team members</li>")).toBe('Team members')
  })
})
