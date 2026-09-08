import { describe, expect, it } from 'vitest'
import {
  MAX_FAILURES_PER_RECOVERY_CATEGORY,
  recordRecoveryFailure,
  recoveryStopDiagnostic,
} from './recoveryBudget'

describe('recoveryBudget', () => {
  it('allows one correction and stops on the second equivalent failure', () => {
    const first = recordRecoveryFailure(undefined, 'schema:missing-content')
    const second = recordRecoveryFailure(first.state, 'schema:missing-content')

    expect(first.action).toBe('correct')
    expect(second).toMatchObject({ action: 'stop', reason: 'equivalent_failure' })
    expect(second.state.totalFailures).toBe(MAX_FAILURES_PER_RECOVERY_CATEGORY)
  })

  it('does not multiply retries when the failure changes category detail', () => {
    const first = recordRecoveryFailure(undefined, 'transport:timeout')
    const second = recordRecoveryFailure(first.state, 'transport:http-500')

    expect(second).toMatchObject({ action: 'stop', reason: 'category_budget' })
    expect(recoveryStopDiagnostic('transport', second.state)).toContain('2/2')
  })
})
