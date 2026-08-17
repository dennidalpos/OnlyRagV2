/**
 * Parses raw test-runner stdout/stderr into a structured pass/fail result,
 * instead of the agent having to interpret raw terminal text through
 * heuristics in DiagnosticOutputReducer (see run_tests / AGT8). Recognizes
 * the summary line formats of the most common JS and Python test runners;
 * falls back to a generic exit-code-only result when none match, so an
 * unrecognized runner never silently reports a wrong pass/fail count.
 */

export type TestFramework = 'vitest' | 'jest' | 'pytest' | 'mocha' | 'unknown'

export interface TestRunResult {
  success: boolean
  passed: number | null
  failed: number | null
  total: number | null
  framework: TestFramework
  summary: string
}

function buildResult(framework: TestFramework, passed: number, failed: number, total: number): TestRunResult {
  return {
    success: failed === 0,
    passed,
    failed,
    total,
    framework,
    summary:
      failed === 0
        ? `${passed}/${total} tests passed (${framework}).`
        : `${failed}/${total} tests FAILED, ${passed}/${total} passed (${framework}).`,
  }
}

function matchVitest(output: string): TestRunResult | null {
  const m = output.match(/Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed\s*\((\d+)\)/)
  if (!m) return null
  const failed = m[1] ? parseInt(m[1], 10) : 0
  return buildResult('vitest', parseInt(m[2], 10), failed, parseInt(m[3], 10))
}

function matchJest(output: string): TestRunResult | null {
  const m = output.match(/Tests:\s+(?:(\d+)\s+failed,\s*)?(\d+)\s+passed,\s+(\d+)\s+total/)
  if (!m) return null
  const failed = m[1] ? parseInt(m[1], 10) : 0
  return buildResult('jest', parseInt(m[2], 10), failed, parseInt(m[3], 10))
}

function matchPytest(output: string): TestRunResult | null {
  const summaryLine = output.match(/={3,}[^\n]*?\bin\s+[\d.]+s\b[^\n]*={3,}/i)
  if (!summaryLine) return null
  const line = summaryLine[0]
  const failedMatch = line.match(/(\d+)\s+failed/i)
  const errorMatch = line.match(/(\d+)\s+error/i)
  const passedMatch = line.match(/(\d+)\s+passed/i)
  const failed = (failedMatch ? parseInt(failedMatch[1], 10) : 0) + (errorMatch ? parseInt(errorMatch[1], 10) : 0)
  const passed = passedMatch ? parseInt(passedMatch[1], 10) : 0
  if (passed === 0 && failed === 0) return null
  return buildResult('pytest', passed, failed, passed + failed)
}

function matchMocha(output: string): TestRunResult | null {
  const passingMatch = output.match(/(\d+)\s+passing\b/i)
  const failingMatch = output.match(/(\d+)\s+failing\b/i)
  if (!passingMatch && !failingMatch) return null
  const passed = passingMatch ? parseInt(passingMatch[1], 10) : 0
  const failed = failingMatch ? parseInt(failingMatch[1], 10) : 0
  return buildResult('mocha', passed, failed, passed + failed)
}

/**
 * Parses combined stdout/stderr from a test command into a structured result.
 * Tries each known framework's summary format in turn; if none match, falls
 * back to reporting success purely from the process exit code.
 */
export function parseTestRunOutput(rawOutput: string, exitCode: number): TestRunResult {
  const matched = matchVitest(rawOutput) || matchJest(rawOutput) || matchPytest(rawOutput) || matchMocha(rawOutput)
  if (matched) return matched

  return {
    success: exitCode === 0,
    passed: null,
    failed: null,
    total: null,
    framework: 'unknown',
    summary:
      exitCode === 0
        ? 'Test command completed successfully (exit code 0), but no recognized test framework summary was found in the output.'
        : `Test command failed (exit code ${exitCode}), but no recognized test framework summary was found in the output.`,
  }
}
