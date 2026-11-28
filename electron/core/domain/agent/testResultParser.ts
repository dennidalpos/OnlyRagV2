import stripAnsi from 'strip-ansi'

export type TestFramework = 'vitest' | 'jest' | 'pytest' | 'mocha' | 'go' | 'rust' | 'node' | 'unknown'

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
    summary: failed === 0 ? `${passed}/${total} tests passed (${framework}).` : `${failed}/${total} tests FAILED, ${passed}/${total} passed (${framework}).`,
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
  const summaryLine = output.match(/^(?:=+\s*)?\d+\s+(?:passed|failed|errors?|skipped|deselected|xfailed|xpassed)\b[^\n]*?\bin\s+[\d.]+s\b[^\n]*$/im)
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

function matchGo(output: string): TestRunResult | null {
  const tests = new Map<string, string>()
  for (const line of output.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line)
      // Package-level pass/skip also occurs when no tests exist; it is not behavioral proof.
      if (typeof event?.Package === 'string' && typeof event.Test === 'string' && event.Test && ['pass', 'fail', 'skip'].includes(event.Action)) {
        tests.set(`${event.Package}\0${event.Test}`, event.Action)
      }
    } catch {
      // Other tools and test output are not Go test events.
    }
  }
  if (!tests.size) return null
  const outcomes = [...tests.values()]
  return buildResult('go', outcomes.filter((action) => action === 'pass').length, outcomes.filter((action) => action === 'fail').length, tests.size)
}

function matchRust(output: string): TestRunResult | null {
  const summaries = [...output.matchAll(/^test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored;/gm)]
  if (!summaries.length) return null
  const passed = summaries.reduce((sum, match) => sum + Number(match[1]), 0)
  const failed = summaries.reduce((sum, match) => sum + Number(match[2]), 0)
  const ignored = summaries.reduce((sum, match) => sum + Number(match[3]), 0)
  return buildResult('rust', passed, failed, passed + failed + ignored)
}

function matchNode(output: string): TestRunResult | null {
  const total = output.match(/^[#ℹ]\s+tests\s+(\d+)\s*$/m)
  const passed = output.match(/^[#ℹ]\s+pass\s+(\d+)\s*$/m)
  const failed = output.match(/^[#ℹ]\s+fail\s+(\d+)\s*$/m)
  return total && passed && failed ? buildResult('node', Number(passed[1]), Number(failed[1]), Number(total[1])) : null
}

/** Parses combined stdout/stderr from a test command into a structured result. */
export function parseTestRunOutput(rawOutput: string, exitCode: number): TestRunResult {
  const output = stripAnsi(rawOutput)
  const matched =
    matchGo(output) || matchVitest(output) || matchJest(output) || matchPytest(output) || matchMocha(output) || matchRust(output) || matchNode(output)
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
