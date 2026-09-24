/** Reads a failing Jest/Vitest/node:test run the way compilerDiagnosticDirective reads tsc: which file, which assertion. */

const ANSI = /\u001b\[[0-9;]*m/g
const TEST_FILE = /(?:^|\s)(?:FAIL|×|✕|❯)\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\b/m
const TEST_FILE_PATH = /(^|[\\/])[^\\/]+\.(?:test|spec)\.[cm]?[jt]sx?$/i
/** Vitest: "Failed Suites" / "(0 test)"; Jest: "Test suite failed to run". Nothing in the file ran. */
const SUITE_DID_NOT_LOAD = /Failed Suites|\(0 tests?\)|Test suite failed to run/i
const MAX_EVIDENCE_CHARS = 400
const TEST_GLOBAL = /ReferenceError:\s*(describe|it|test|expect|vi|beforeEach|afterEach|beforeAll|afterAll) is not defined/
const TEST_GLOBAL_CALL = /^(describe|it|test|expect|beforeEach|afterEach|beforeAll|afterAll)\s*\(/
const UNDEFINED_NAME = /ReferenceError:\s*([A-Za-z_$][\w$]*) is not defined/
/** Where the names a React smoke test typically forgets come from. */
const KNOWN_PROVIDERS: Record<string, string> = {
  React: "import React from 'react'",
  renderToString: "import { renderToString } from 'react-dom/server'",
  renderToStaticMarkup: "import { renderToStaticMarkup } from 'react-dom/server'",
  render: "import { render, screen } from '@testing-library/react'",
  screen: "import { render, screen } from '@testing-library/react'",
}
const NO_TEST_DECLARED = /No test suite found in file|Your test suite must contain at least one test/i
const FAILED_TO_RESOLVE = /Failed to resolve import\s+["'](\.{1,2}\/[^"']+)["']/
const RELATIVE_SPECIFIER = /(?:\bfrom\s+|\bimport\s+|\brequire\(\s*)["'](\.{1,2}\/[^"']+)["']/
/** Chai assertion message in Vitest 0.x (expected '...' to include '...'). */
const CHAI_INCLUDE =
  /AssertionError:\s*expected\s+(['"])((?:\\.|(?!\1).)*)\1\s+to\s+(?:include|contain|match|have string)\s+(?:(['"])((?:\\.|(?!\3).)*)\3|(\/.+?\/[a-z]*))/
const TRUNCATED = /(?:…|\.\.\.)$/

export interface FailingTest {
  file: string
  kind: 'load' | 'assertion'
  loadLine?: { line: number; source: string }
  expected: string | null
  received: string | null
  missingGlobal?: string
  unresolvedImport?: string
  runner?: 'vitest' | 'jest'
  declaresNoTest?: boolean
  undefinedName?: string
  receivedTruncated?: boolean
}

/** Text the tested module renders literally, used when runner output is truncated. */
export interface TestedModuleText {
  text: string
  module: string
}

function bounded(value: string): string {
  const clean = value.trim()
  return clean.length > MAX_EVIDENCE_CHARS ? `${clean.slice(0, MAX_EVIDENCE_CHARS)}…` : clean
}

function evidenceLine(text: string, label: RegExp): string | null {
  const match = label.exec(text)
  return match ? bounded(match[1]) : null
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

/** True for a Jest/Vitest test file (`App.test.jsx`, `api.spec.ts`). */
export function isTestFilePath(filePath: string | undefined): boolean {
  return Boolean(filePath) && TEST_FILE_PATH.test(filePath!)
}

/** The failing test file and why it failed, or null when the output is not a failing test run. */
export function extractFailingTest(output: string): FailingTest | null {
  const text = (output || '').replace(ANSI, '')
  const raw = TEST_FILE.exec(text)?.[1]
  if (!raw) return null
  const file = raw.replace(/\\/g, '/').replace(/^\.\//, '')
  const didNotLoad = SUITE_DID_NOT_LOAD.test(text)
  const declaresNoTest = NO_TEST_DECLARED.test(text)
  const loadLine = pointedSourceLine(text, file)
  const runner = /\bvitest\b/i.test(text) ? 'vitest' : /\bjest\b|react-scripts test/i.test(text) ? 'jest' : undefined
  // The code frame names the call the runner stopped at even when the message itself is lost.
  const missingGlobal =
    TEST_GLOBAL.exec(text)?.[1] ?? (didNotLoad && /ReferenceError/.test(text) ? TEST_GLOBAL_CALL.exec(loadLine?.source ?? '')?.[1] : undefined)
  const referenced = UNDEFINED_NAME.exec(text)?.[1]
  const undefinedName = referenced && !missingGlobal ? referenced : undefined
  const unresolvedImport =
    didNotLoad && !missingGlobal && !declaresNoTest && !undefinedName
      ? (FAILED_TO_RESOLVE.exec(text)?.[1] ?? RELATIVE_SPECIFIER.exec(loadLine?.source ?? '')?.[1])
      : undefined
  const chai = CHAI_INCLUDE.exec(text)
  const receivedLine = evidenceLine(text, /^\s*Received(?: string| value)?:\s*(.+)$/m)
  const expected = evidenceLine(text, /^\s*Expected(?: substring| value)?:\s*(.+)$/m) ?? (chai ? bounded(chai[4] ?? chai[5]) : null)
  const received = receivedLine ?? (chai ? bounded(chai[2]) : null)
  const receivedTruncated = Boolean(!receivedLine && received && TRUNCATED.test(received))
  return {
    file,
    kind: didNotLoad ? 'load' : 'assertion',
    loadLine,
    expected,
    received,
    ...(receivedTruncated ? { receivedTruncated } : {}),
    ...(runner ? { runner } : {}),
    ...(missingGlobal ? { missingGlobal } : {}),
    ...(unresolvedImport ? { unresolvedImport } : {}),
    ...(declaresNoTest ? { declaresNoTest } : {}),
    ...(undefinedName ? { undefinedName } : {}),
  }
}

/** The directive for a name the test uses but never imports. */
function buildUndefinedNameDirective(failing: FailingTest, name: string): string {
  const provider = KNOWN_PROVIDERS[name] ?? (name === failing.missingGlobal ? testGlobalsImport(failing) : undefined)
  return [
    `[THE TEST USES "${name}" WITHOUT IMPORTING IT — "${failing.file}"${failing.loadLine ? ` line ${failing.loadLine.line}` : ''}]`,
    ...(failing.loadLine ? [`The runner stopped at: ${failing.loadLine.source}`] : []),
    `ReferenceError: ${name} is not defined. The assertion never ran, so it is not the problem.`,
    'Directives:',
    `1. Your next tool call MUST be "write_file" on "${failing.file}": the same complete file with ${provider ? `this exact line added after the other imports: ${provider}` : `the import that provides "${name}" added at the top`}.`,
    '2. Do NOT run the test again before a file has changed.',
  ].join('\n')
}

/**
 * The specifier that reaches the module a broken test import meant: the same name next to the
 * test file, or one folder up. `resolvesTo` reports whether a specifier resolves from the test file.
 */
export function correctedTestImport(testFile: string, specifier: string, resolvesTo: (importingFile: string, specifier: string) => boolean): string | null {
  const name = specifier.split('/').pop()
  if (!name) return null
  const candidates = [`./${name}`, `../${name}`].filter((candidate) => candidate !== specifier)
  return candidates.find((candidate) => resolvesTo(testFile, candidate)) ?? null
}

/** The import line a test needs for the globals Vitest does not inject unless `globals: true`. */
function testGlobalsImport(failing: FailingTest): string {
  return failing.runner === 'jest' ? "import { describe, it, expect } from '@jest/globals'" : "import { describe, it, expect } from 'vitest'"
}

/**
 * Full task runs 8 and 12 of 2026-09-24: the generic "an import does not resolve" directive left
 * `import App from '../App'` in place four times, and was simply wrong for `describe is not
 * defined`. Both fixes are computable, so the directive states the exact line.
 */
function buildLoadFailureDirective(failing: FailingTest, resolvesTo?: (importingFile: string, specifier: string) => boolean): string {
  const header = [
    `[THE TEST FILE DID NOT LOAD — "${failing.file}"${failing.loadLine ? ` line ${failing.loadLine.line}` : ''}]`,
    ...(failing.loadLine ? [`The runner stopped at: ${failing.loadLine.source}`] : []),
  ]
  const noRerun = 'Do NOT run the test again before a file has changed.'

  if (failing.missingGlobal) {
    const importLine = testGlobalsImport(failing)
    return [
      ...header,
      `"${failing.missingGlobal}" is not defined: this runner does not inject describe/it/expect as globals, so the file must import them. The test body is not the problem.`,
      'Directives:',
      `1. Your next tool call MUST be "write_file" on "${failing.file}": the same complete file with this exact first line added: ${importLine}`,
      `2. ${noRerun}`,
    ].join('\n')
  }

  if (failing.declaresNoTest) {
    // Full task run 13 of 2026-09-24: the smoke test put its expect() inside an exported helper
    // that nothing called, and the generic import advice left it that way.
    return [
      ...header,
      `The file loaded, but it declares no test: the runner only runs assertions written inside it('...', () => { ... }) or test('...', () => { ... }). A helper function that nothing calls is not a test.`,
      'Directives:',
      `1. Your next tool call MUST be "write_file" on "${failing.file}": the complete file with ${testGlobalsImport(failing)} after the other imports, and every expect() inside one it('renders the app', () => { ... }) block. No exported helper.`,
      `2. ${noRerun}`,
    ].join('\n')
  }

  const corrected = failing.unresolvedImport && resolvesTo ? correctedTestImport(failing.file, failing.unresolvedImport, resolvesTo) : null
  if (failing.unresolvedImport && corrected) {
    const source = failing.loadLine?.source
    const fixedLine = source?.includes(failing.unresolvedImport) ? source.replace(failing.unresolvedImport, corrected) : null
    return [
      ...header,
      `"${failing.unresolvedImport}" does not resolve from "${failing.file}"; "${corrected}" does. A relative import is resolved from the folder of the file that contains it.`,
      'Directives:',
      `1. Your next tool call MUST be "write_file" on "${failing.file}": the same complete file with ${fixedLine ? `the line "${source}" replaced by exactly: ${fixedLine}` : `every "${failing.unresolvedImport}" import changed to "${corrected}"`}`,
      `2. ${noRerun}`,
    ].join('\n')
  }

  return [
    ...header,
    `No test ran: the file failed before its first test, which is almost always an import that does not resolve. A relative import is resolved from the folder of "${failing.file}", so a file in that same folder is imported as "./Name", not "../Name".`,
    'Directives:',
    `1. Your next tool call MUST be "write_file" on "${failing.file}", with the complete file and that import pointing at a file that exists.`,
    `2. ${noRerun}`,
  ].join('\n')
}

/** One instruction for a failing test: fix the import that kept it from loading, or the assertion that disagrees with the code. */
/** Visible text the rendered output really contains (a text node of at least three letters), quote-free so it can be pasted into a string literal. */
export function renderedTextFragment(received: string | null): string | null {
  if (!received) return null
  const html = received.replace(/\\"/g, '"')
  for (const match of html.matchAll(/>\s*([^<>]+?)\s*</g)) {
    const text = match[1].trim()
    if (/[A-Za-z]{3}/.test(text) && !/["'`\\]/.test(text)) return text
  }
  return null
}

/** The first JSX text child of at least three letters in `source`, whitespace-collapsed as React renders it and quote-free. */
export function literalJsxText(source: string): string | null {
  for (const match of source.matchAll(/>([^<>{}]+)<\//g)) {
    const text = match[1].replace(/\s+/g, ' ').trim()
    if (/[A-Za-z]{3}/.test(text) && !/["'`\\&=;()|]/.test(text)) return text
  }
  return null
}

/**
 * Literal text a module the test imports renders, so a failing text assertion can be rewritten even
 * when the runner printed no usable received value. Read, never guessed: a JSX text child in the
 * module source is what renderToString and the testing libraries return for it.
 */
export function testedModuleText(
  testFile: string,
  readFile: (workspaceRelativePath: string) => string | null,
  readModule: (importingFile: string, specifier: string) => string | null,
): TestedModuleText | null {
  const testSource = readFile(testFile)
  if (!testSource) return null
  for (const match of testSource.matchAll(/\bfrom\s+["'](\.{1,2}\/[^"']+)["']/g)) {
    const module = match[1]
    if (/\.(?:css|scss|sass|less|svg|png|jpe?g|gif|json)$/i.test(module) || isTestFilePath(module)) continue
    const text = literalJsxText(readModule(testFile, module) ?? '')
    if (text) return { text, module }
  }
  return null
}

/** A code-frame line without its trailing comment, which the runner may have cut short with "…". */
function withoutTrailingComment(source: string): string {
  return source.replace(/\s*\/\/.*$/, '').trimEnd()
}

/** The failing assertion line with its expected literal replaced by `text`, or null when the line is not a single toContain/toMatch. */
function assertionRewrite(source: string, text: string): string | null {
  const pattern = /\.(toContain|toMatch)\(\s*(['"`])(?:\\.|(?!\2).)*\2\s*\)/
  return pattern.test(source) ? source.replace(pattern, (_match, matcher: string) => `.${matcher}('${text}')`) : null
}

export function buildTestFailureDirective(
  failing: FailingTest,
  resolvesTo?: (importingFile: string, specifier: string) => boolean,
  moduleText?: TestedModuleText | null,
): string {
  // A test global missing inside a test that ran (`expect is not defined`) needs the same import as one missing at load.
  const undefinedName = failing.undefinedName ?? (failing.kind === 'assertion' ? failing.missingGlobal : undefined)
  if (undefinedName) return buildUndefinedNameDirective(failing, undefinedName)
  if (failing.kind === 'load') return buildLoadFailureDirective(failing, resolvesTo)
  // Full task run 14 of 2026-09-24: told to "assert content the code really produces", the model
  // re-proposed the same failing toContain('<div class="bg-white">') twenty times. The rendered
  // output is in the runner's Received line, so the corrected assertion is computable.
  // When the runner cut the received value short (Vitest 0.x), the tested module's own JSX text is the fallback.
  const receivedText = renderedTextFragment(failing.received)
  const text = receivedText ?? moduleText?.text ?? null
  const failingLine = failing.loadLine ? withoutTrailingComment(failing.loadLine.source) : null
  const rewritten = text && failingLine ? assertionRewrite(failingLine, text) : null
  const exactFix = rewritten
    ? `the line "${failingLine}" (and any comment after it) replaced by exactly: ${rewritten}`
    : text
      ? `its failing assertion replaced by one on text the page really renders, e.g. expect(html).toContain('${text}')`
      : `the test rewritten so that it asserts content the code really produces${failing.received ? ' (the Received value above)' : ''}`
  return [
    `[THE TEST RAN AND ITS ASSERTION FAILED — "${failing.file}"${failing.loadLine ? ` line ${failing.loadLine.line}` : ''}]`,
    ...(failing.expected ? [`Expected: ${failing.expected}`] : []),
    ...(failing.received ? [`Received${failing.receivedTruncated ? ' (cut short by the runner)' : ''}: ${failing.received}`] : []),
    ...(!receivedText && moduleText ? [`"${moduleText.module}", which the test renders, contains the literal text '${moduleText.text}'.`] : []),
    `The runner, the dependencies and the script all work: only the assertion disagrees with what the code produced. Running the test again cannot change that.`,
    `Directives:`,
    `1. Your next tool call MUST be "write_file" on "${failing.file}": the same complete file with ${exactFix}. If the Received output shows the application itself is broken (empty, or an error), fix the application file instead.`,
    `2. Do NOT run the test again before a file has changed.`,
  ].join('\n')
}
