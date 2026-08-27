import type { RollbackResult } from '../infrastructure/filesystem/atomicWorkspaceJournal'
import type { ToolExecutionResult } from '../domain/agent/tools/toolExecutionContracts'

interface RecoveryJournal {
  rollbackAll(): RollbackResult
  rollbackLastStep(): RollbackResult
  readonly canRollbackLastStep: boolean
}

/** Application service for session-wide workspace recovery. */
export class RecoveryToolService {
  constructor(private readonly journal: RecoveryJournal) {}

  rollbackWorkspace(): RollbackResult {
    return this.journal.rollbackAll()
  }

  executeRollbackWorkspace(): ToolExecutionResult {
    const result = this.rollbackWorkspace()
    const summary = `[ATOMIC WORKSPACE ROLLBACK EXECUTED]\nRestored: ${result.restoredCount} file(s).\n` +
      (result.errors.length > 0 ? `Errors: ${result.errors.join('; ')}` : 'All journaled modifications successfully reverted to pre-session state.')
    return {
      outputForHistory: summary,
      logMessage: `Workspace Rollback: ${result.restoredCount} files restored`,
    }
  }

  rollbackLastStep(): RollbackResult {
    return this.journal.rollbackLastStep()
  }

  executeRollbackLastStep(): ToolExecutionResult {
    if (!this.journal.canRollbackLastStep) {
      return {
        outputForHistory: '[ROLLBACK LAST STEP] Nothing to undo: the previous step made no file changes, or there is no completed step yet.',
        logMessage: 'Rollback Last Step: nothing to undo',
      }
    }
    const result = this.rollbackLastStep()
    const summary = `[LAST STEP ROLLBACK EXECUTED]\nRestored: ${result.restoredCount} file(s) to their state before the previous step.\n` +
      (result.errors.length > 0 ? `Errors: ${result.errors.join('; ')}` : 'Only the previous step\'s changes were reverted; earlier steps in this session are untouched.')
    return {
      outputForHistory: summary,
      logMessage: `Rollback Last Step: ${result.restoredCount} files restored`,
    }
  }
}
