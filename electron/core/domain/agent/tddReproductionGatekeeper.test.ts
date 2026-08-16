import { describe, it, expect } from 'vitest'
import { TDDReproductionFirstGatekeeper } from './tddReproductionGatekeeper'

describe('TDDReproductionFirstGatekeeper', () => {
  it('should block source code mutation before reproduction test is created', () => {
    const gate = new TDDReproductionFirstGatekeeper()
    const res = gate.validateAction('write_file', 'src/main.ts')

    expect(res.allowed).toBe(false)
    expect(res.reason).toContain('TDD Violation')
  })

  it('should allow reproduction test creation and guide through workflow', () => {
    const gate = new TDDReproductionFirstGatekeeper()
    gate.registerReproTest('tests/repro.spec.ts')

    // Block mutation before test failure confirmation
    const res1 = gate.validateAction('write_file', 'src/main.ts')
    expect(res1.allowed).toBe(false)

    // Confirm test failure
    const res2 = gate.validateAction('run_command', 'npx vitest run tests/repro.spec.ts', true, false)
    expect(res2.allowed).toBe(true)
    expect(gate.currentState).toBe('REPRO_TEST_FAILED')

    // Permit source code mutation
    const res3 = gate.validateAction('write_file', 'src/main.ts')
    expect(res3.allowed).toBe(true)

    // Confirm test pass
    const res4 = gate.validateAction('run_command', 'npx vitest run tests/repro.spec.ts', true, true)
    expect(res4.allowed).toBe(true)
    expect(gate.currentState).toBe('REPRO_TEST_PASSED')
  })
})
