import { describe, it, expect } from 'vitest'
import { isFailureOutput } from './agentOrchestratorToolResultProcessor'

/**
 * This predicate decides one label, and the label is read three times: the loop detector is
 * told whether the repeat succeeded, only failures reach the buffer that survives FIFO
 * trimming, and the trajectory table prints it. A marker missing from the list is therefore not
 * a cosmetic gap — it is a result the whole loop then reasons about backwards.
 */
describe('isFailureOutput', () => {
  it('reports a write rejected by the pre-commit AST check as a failure', () => {
    // The regression, verbatim from the live run of 2026-08-24 (steps 46, 47, 49, 50): four
    // writes rejected for a syntax error, none of which reached the disk, all recorded SUCCESS.
    const output =
      '[PRE-COMMIT AST VALIDATION ERROR IN src/pages/TasksPage.tsx]\n' +
      "Expression expected (Line 42:9)\nFile write blocked before disk persistence to prevent workspace corruption. Please fix syntax error."

    expect(isFailureOutput(output)).toBe(true)
  })

  it('reports a replacement rejected by the same check as a failure', () => {
    const output =
      '[PRE-COMMIT AST VALIDATION ERROR IN src/App.tsx]\n' +
      "'}' expected (Line 7:1)\nReplacement blocked before disk persistence to prevent syntax corruption."

    expect(isFailureOutput(output)).toBe(true)
  })

  it.each([
    ['a failing terminal command', 'Exit code 1\n[TERMINAL AUTO-HEALING DIAGNOSTICS LOG]\nvite: not found'],
    ['a failed chunk replacement', '[REPLACE FILE ERROR] target chunk not found in src/App.tsx'],
    ['a blocked path', 'Security Violation: path escapes the workspace root'],
    ['a bare error result', 'Error: ENOENT: no such file or directory'],
  ])('keeps reporting %s as a failure', (_label, output) => {
    expect(isFailureOutput(output)).toBe(true)
  })

  it.each([
    ['a completed write', 'Successfully wrote file src/App.tsx'],
    ['a no-op write', 'No-op write: globals.css was already up to date'],
    ['a finished command', 'Terminal Command Finished: npm install'],
    ['an empty result', ''],
  ])('leaves %s as a success', (_label, output) => {
    expect(isFailureOutput(output)).toBe(false)
  })

  it('does not mistake the word "error" inside a successful result for a failure', () => {
    // `startsWith` and not `includes`, deliberately: a file whose content mentions an error
    // handler is not a failed write, and widening this to a substring match would label every
    // such write a failure.
    expect(isFailureOutput('Successfully wrote file src/errorBoundary.tsx')).toBe(false)
  })
})
