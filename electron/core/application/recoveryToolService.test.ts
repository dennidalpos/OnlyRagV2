import { describe, expect, it, vi } from 'vitest'
import { RecoveryToolService } from './recoveryToolService'

describe('RecoveryToolService rollback_workspace', () => {
  it('delegates session recovery and reports restored files', () => {
    const rollbackAll = vi.fn(() => ({ restoredCount: 2, errors: [] }))
    const result = new RecoveryToolService({ rollbackAll, rollbackLastStep: vi.fn(), canRollbackLastStep: false }).executeRollbackWorkspace()

    expect(rollbackAll).toHaveBeenCalledOnce()
    expect(result.outputForHistory).toContain('Restored: 2 file(s).')
    expect(result.outputForHistory).toContain('successfully reverted')
  })

  it('is idempotent when the journal has nothing left to restore', () => {
    const rollbackAll = vi
      .fn()
      .mockReturnValueOnce({ restoredCount: 1, errors: [] })
      .mockReturnValueOnce({ restoredCount: 0, errors: [] })
    const service = new RecoveryToolService({ rollbackAll, rollbackLastStep: vi.fn(), canRollbackLastStep: false })

    const first = service.executeRollbackWorkspace()
    const second = service.executeRollbackWorkspace()

    expect(first.outputForHistory).toContain('Restored: 1 file(s).')
    expect(second.outputForHistory).toContain('Restored: 0 file(s).')
    expect(rollbackAll).toHaveBeenCalledTimes(2)
  })

  it('includes recovery errors in the terminal result', () => {
    const result = new RecoveryToolService({
      rollbackAll: () => ({ restoredCount: 0, errors: ['failed restoring file.txt'] }),
      rollbackLastStep: vi.fn(),
      canRollbackLastStep: false,
    }).executeRollbackWorkspace()

    expect(result.outputForHistory).toContain('Errors: failed restoring file.txt')
    expect(result.logMessage).toContain('0 files restored')
  })

  it('rolls back only the last completed step and consumes the journal entry', () => {
    const rollbackLastStep = vi.fn(() => ({ restoredCount: 1, errors: [] }))
    const journal = { rollbackAll: vi.fn(), rollbackLastStep, canRollbackLastStep: true }
    const result = new RecoveryToolService(journal).executeRollbackLastStep()

    expect(rollbackLastStep).toHaveBeenCalledOnce()
    expect(result.outputForHistory).toContain('Restored: 1 file(s)')
    expect(result.outputForHistory).toContain('earlier steps in this session are untouched')
  })

  it('does not call recovery when there is no completed step', () => {
    const rollbackLastStep = vi.fn()
    const result = new RecoveryToolService({ rollbackAll: vi.fn(), rollbackLastStep, canRollbackLastStep: false }).executeRollbackLastStep()

    expect(result.outputForHistory).toContain('Nothing to undo')
    expect(rollbackLastStep).not.toHaveBeenCalled()
  })
})
