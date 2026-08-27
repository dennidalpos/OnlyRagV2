import { describe, it, expect } from 'vitest'
import { isFailureOutput, terminalOutcomeFor } from './agentOrchestratorToolResultProcessor'
import { packagesWithFailedInstall } from '../domain/agent/installCommandParser'
import { resolvePlanDirective } from '../domain/agent/planDirectiveArbiter'

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

describe('MODEL_UNSUITABLE terminal outcome', () => {
  it('returns from processing instead of continuing the agent loop', () => {
    const outcome = terminalOutcomeFor({
      outputForHistory: 'The requested model capability is unavailable.',
      logMessage: 'Model capability unavailable',
      isTerminal: true,
      terminalCode: 'MODEL_UNSUITABLE',
    })

    expect(outcome).toEqual({
      outcome: 'return',
      result: { success: false, summary: 'The requested model capability is unavailable.' },
    })
    expect(outcome?.outcome).not.toBe('continue')
  })
})

/**
 * The same class of bug as the pre-commit marker above, found in the runs of 2026-08-25, and
 * the reason two consecutive live sessions ended at the 50-step cap with nothing verified.
 *
 * The registry guard refuses to install a package npm has never heard of. That refusal was not
 * on the marker list, so it was recorded SUCCESS — and a SUCCESS is what
 * packagesWithFailedInstall uses to RESET a package's failure count. The count could never
 * reach the threshold, so planDirectiveArbiter never escalated to `dependencies_uninstallable`
 * and kept ordering the one install that could not work. The guard refused it again. Repeat
 * until the step cap.
 *
 * These tests pin the whole path, not just the label: refusal -> counted as a failure ->
 * arbiter tells the model to rewrite the import instead of installing.
 */
describe('refused installs reach the plan directive arbiter', () => {
  const REFUSAL =
    '[PACKAGE DOES NOT EXIST — INSTALL NOT RUN]\n' +
    'The npm registry has no package named "@tailwindcss/react". This command was not executed, ' +
    'because no flag makes an install of a non-existent package succeed.\n' +
    'Directives:\n1. Do NOT run this install again, and do NOT add --force or --legacy-peer-deps.'

  it('reports a registry-refused install as a failure', () => {
    expect(isFailureOutput(REFUSAL)).toBe(true)
  })

  it('reports a preflight downgrade refusal as a failure', () => {
    expect(isFailureOutput('[VERSION DOWNGRADE REFUSED — INSTALL NOT RUN]\nThe command was not executed.')).toBe(true)
  })

  it('counts refusals toward the uninstallable threshold instead of resetting it', () => {
    const episodes = [
      { tool: 'run_command', target: 'npm install @tailwindcss/react', status: 'FAILURE' as const },
      { tool: 'run_command', target: 'npm install @tailwindcss/react', status: 'FAILURE' as const },
    ]
    expect(packagesWithFailedInstall(episodes)).toContain('@tailwindcss/react')
  })

  it('was defeated by the old SUCCESS label, which reset the count', () => {
    // Pins the mechanism that caused the livelock, so a future change that reclassifies the
    // refusal back to SUCCESS fails here rather than in a fifty-step live run.
    const episodes = [
      { tool: 'run_command', target: 'npm install @tailwindcss/react', status: 'FAILURE' as const },
      { tool: 'run_command', target: 'npm install @tailwindcss/react', status: 'SUCCESS' as const },
      { tool: 'run_command', target: 'npm install @tailwindcss/react', status: 'FAILURE' as const },
    ]
    expect(packagesWithFailedInstall(episodes)).not.toContain('@tailwindcss/react')
  })

  it('stops ordering the install and orders the import rewrite once the package is known bad', () => {
    const undeclared = [{ packageName: '@tailwindcss/react', importedBy: ['src/pages/DashboardPage.tsx'] }]
    const base = {
      hasVerifiedBuild: false,
      milestones: [],
      activeMilestone: undefined,
      deliverableStatusOf: () => ({ satisfied: false, missing: [], resolved: [] }) as any,
      missingDependencies: [],
      undeclaredDependencies: undeclared,
      verificationCommand: null,
      verificationFailing: false,
      disconnectedEntrypoint: null,
    }

    // Before the package is known bad, ordering the install is the right call.
    expect(resolvePlanDirective({ ...base, packagesWithFailedInstall: [] }).kind).toBe('dependencies_undeclared')

    // Once it is, ordering it again "is not a directive, it is a loop with a preamble".
    const escalated = resolvePlanDirective({ ...base, packagesWithFailedInstall: ['@tailwindcss/react'] })
    expect(escalated.kind).toBe('dependencies_uninstallable')
    expect(escalated.blockDirective).toContain('@tailwindcss/react')
  })
})
