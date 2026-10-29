import { describe, it, expect } from 'vitest'
import { parseTestRunOutput } from './testResultParser'

describe('parseTestRunOutput (AGT8: structured run_tests pass/fail parsing)', () => {
  it('should parse a passing Vitest summary', () => {
    const output = ' RUN  v4.1.10\n\n········\n\n Test Files  1 passed (1)\n      Tests  10 passed (10)\n'
    const res = parseTestRunOutput(output, 0)
    expect(res).toEqual({ success: true, passed: 10, failed: 0, total: 10, framework: 'vitest', summary: '10/10 tests passed (vitest).' })
  })

  it('should parse a failing Vitest summary (mixed pass/fail)', () => {
    const output = 'Test Files  1 failed (2)\n      Tests  3 failed | 7 passed (10)\n'
    const res = parseTestRunOutput(output, 1)
    expect(res.success).toBe(false)
    expect(res.passed).toBe(7)
    expect(res.failed).toBe(3)
    expect(res.total).toBe(10)
    expect(res.framework).toBe('vitest')
    expect(res.summary).toContain('3/10 tests FAILED')
  })

  it('should parse a passing Jest summary', () => {
    const output = 'Test Suites: 2 passed, 2 total\nTests:       8 passed, 8 total\nSnapshots:   0 total\n'
    const res = parseTestRunOutput(output, 0)
    expect(res).toEqual({ success: true, passed: 8, failed: 0, total: 8, framework: 'jest', summary: '8/8 tests passed (jest).' })
  })

  it('should parse a failing Jest summary', () => {
    const output = 'Tests:       2 failed, 8 passed, 10 total\n'
    const res = parseTestRunOutput(output, 1)
    expect(res.success).toBe(false)
    expect(res.passed).toBe(8)
    expect(res.failed).toBe(2)
    expect(res.total).toBe(10)
    expect(res.framework).toBe('jest')
  })

  it('should parse a passing pytest summary', () => {
    const output = 'collected 42 items\n\n................\n\n===== 42 passed in 1.23s =====\n'
    const res = parseTestRunOutput(output, 0)
    expect(res).toEqual({ success: true, passed: 42, failed: 0, total: 42, framework: 'pytest', summary: '42/42 tests passed (pytest).' })
  })

  it('recognizes quiet pytest and Rust summaries while retaining a zero executed count', () => {
    expect(parseTestRunOutput('2 passed, 1 skipped in 0.12s', 0)).toMatchObject({ framework: 'pytest', passed: 2, failed: 0 })
    expect(parseTestRunOutput('test result: ok. 0 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out', 0)).toMatchObject({ framework: 'rust', passed: 0 })
    expect(parseTestRunOutput('test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out', 0)).toMatchObject({ framework: 'rust', passed: 2 })
  })

  it('counts Go test events, excluding package success and skipped tests', () => {
    const events = [
      { Action: 'pass', Package: 'fixture' },
      { Action: 'skip', Package: 'fixture', Test: 'TestSkipped' },
      { Action: 'pass', Package: 'fixture', Test: 'TestReal' },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n')
    expect(parseTestRunOutput(events, 0)).toMatchObject({ framework: 'go', passed: 1, failed: 0, total: 2 })
    expect(parseTestRunOutput(JSON.stringify({ Action: 'pass', Package: 'fixture' }), 0).passed).toBeNull()
    expect(parseTestRunOutput(JSON.stringify({ Action: 'skip', Package: 'fixture', Test: 'TestSkipped' }), 0)).toMatchObject({ passed: 0 })
  })

  it('recognizes Node TAP/spec totals without treating skips as passes', () => {
    expect(parseTestRunOutput('# tests 2\n# pass 1\n# fail 0\n# skipped 1', 0)).toMatchObject({ framework: 'node', passed: 1, total: 2 })
    expect(parseTestRunOutput('ℹ tests 1\nℹ pass 0\nℹ fail 0\nℹ skipped 1', 0)).toMatchObject({ framework: 'node', passed: 0 })
  })

  it('should parse a failing pytest summary including errors', () => {
    const output = 'FAILED tests/test_x.py::test_y\n===== 2 failed, 1 error, 40 passed in 3.45s =====\n'
    const res = parseTestRunOutput(output, 1)
    expect(res.success).toBe(false)
    expect(res.passed).toBe(40)
    expect(res.failed).toBe(3) // 2 failed + 1 error
    expect(res.total).toBe(43)
    expect(res.framework).toBe('pytest')
  })

  it('should parse a passing Mocha summary', () => {
    const output = '  Suite\n    ✓ does a thing\n\n  10 passing (45ms)\n'
    const res = parseTestRunOutput(output, 0)
    expect(res).toEqual({ success: true, passed: 10, failed: 0, total: 10, framework: 'mocha', summary: '10/10 tests passed (mocha).' })
  })

  it('should parse a failing Mocha summary', () => {
    const output = '  8 passing (100ms)\n  2 failing\n'
    const res = parseTestRunOutput(output, 1)
    expect(res.success).toBe(false)
    expect(res.passed).toBe(8)
    expect(res.failed).toBe(2)
    expect(res.total).toBe(10)
    expect(res.framework).toBe('mocha')
  })

  it('should fall back to exit-code-only success when no recognized framework summary is found', () => {
    const res = parseTestRunOutput('some unrelated tool output with no test summary', 0)
    expect(res).toEqual({
      success: true,
      passed: null,
      failed: null,
      total: null,
      framework: 'unknown',
      summary: 'Test command completed successfully (exit code 0), but no recognized test framework summary was found in the output.',
    })
  })

  it('should fall back to exit-code-only failure when no recognized framework summary is found and exit code is non-zero', () => {
    const res = parseTestRunOutput('command not found: pytest', 127)
    expect(res.success).toBe(false)
    expect(res.framework).toBe('unknown')
    expect(res.summary).toContain('Test command failed (exit code 127)')
  })
})
