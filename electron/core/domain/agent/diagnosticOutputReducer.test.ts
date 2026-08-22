import { describe, it, expect } from 'vitest'
import { DiagnosticOutputReducer } from './diagnosticOutputReducer'

describe('DiagnosticOutputReducer Unit Tests', () => {
  it('should strip ANSI escape sequences', () => {
    const rawWithAnsi = '\u001b[31mFAIL\u001b[0m \u001b[32msrc/test.ts\u001b[0m'
    const stripped = DiagnosticOutputReducer.stripAnsi(rawWithAnsi)
    expect(stripped).toBe('FAIL src/test.ts')
  })

  it('should preserve short output without modification', () => {
    const shortOutput = 'PASS src/app.test.ts (5 tests)\nAll tests passed.'
    const distilled = DiagnosticOutputReducer.distillTerminalOutput(shortOutput, 1000)
    expect(distilled).toBe(shortOutput)
  })

  it('should distill massive test runner output to errors and summary', () => {
    const noisyLines: string[] = []
    noisyLines.push('Running tests in workspace...')
    for (let i = 0; i < 200; i++) {
      noisyLines.push(`  ✓ src/components/module_${i}.test.ts (1 test) 2ms`)
    }
    noisyLines.push('FAIL src/components/CriticalBug.test.ts')
    noisyLines.push('  AssertionError: expected true to be false')
    noisyLines.push('    at src/components/CriticalBug.test.ts:42:15')
    for (let i = 0; i < 200; i++) {
      noisyLines.push(`  ✓ src/services/service_${i}.test.ts (1 test) 1ms`)
    }
    noisyLines.push('Test Files: 1 failed | 400 passed (401)')
    noisyLines.push('Tests: 1 failed | 400 passed (401)')
    noisyLines.push('Duration: 4.2s')

    const massiveOutput = noisyLines.join('\n')
    expect(massiveOutput.length).toBeGreaterThan(15000)

    const distilled = DiagnosticOutputReducer.distillTerminalOutput(massiveOutput, 2500)
    expect(distilled.length).toBeLessThanOrEqual(2600)
    expect(distilled).toContain('FAIL src/components/CriticalBug.test.ts')
    expect(distilled).toContain('AssertionError: expected true to be false')
    expect(distilled).toContain('Test Files: 1 failed')
  })

  it('should extract error location and message from terminal output', () => {
    const output = `npm ERR! Test failed. See logs.
TypeError: Cannot read property 'id' of undefined
    at processTask (d:/GITHUB/OnlyRagV2/src/main.ts:42:15)`

    const frame = DiagnosticOutputReducer.extractErrorDiagnostics(output)
    expect(frame).not.toBeNull()
    expect(frame?.filePath).toBe('d:/GITHUB/OnlyRagV2/src/main.ts')
    expect(frame?.lineNumber).toBe(42)
    expect(frame?.errorMessage).toContain("Cannot read property 'id'")

    if (frame) {
      const prompt = DiagnosticOutputReducer.formatDiagnosticPrompt(frame)
      expect(prompt).toContain('At d:/GITHUB/OnlyRagV2/src/main.ts:42')
      expect(prompt).toContain("Cannot read property 'id'")
    }
  })
})
