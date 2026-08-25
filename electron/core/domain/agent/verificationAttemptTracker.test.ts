import { describe, it, expect } from 'vitest'
import { buildVerificationFailingDirective, isVerificationFailing } from './verificationAttemptTracker'
import type { TrajectoryStep } from './verificationAttemptTracker'

function step(tool: string, target: string, status: TrajectoryStep['status']): TrajectoryStep {
  return { tool, target, status }
}

const BUILD = 'npm run build'

/**
 * Measured on 2026-08-24, steps 26-34: the plan block ordered `npm run build` while the tool
 * result from that same command ordered `write_file on src/App.tsx` and forbade re-running it.
 * The model obeyed the plan block eight times — the channel that repeats every turn, and the
 * one this project built to be obeyed.
 */
describe('isVerificationFailing', () => {
  it('is true after the check failed with nothing written since', () => {
    expect(isVerificationFailing([step('run_command', BUILD, 'FAILURE')], BUILD)).toBe(true)
  })

  it('is false before the check has ever run', () => {
    expect(isVerificationFailing([step('write_file', 'src/App.tsx', 'SUCCESS')], BUILD)).toBe(false)
  })

  it('is false once a file has actually changed', () => {
    // The code the check judged no longer exists, so its verdict is stale.
    const episodes = [step('run_command', BUILD, 'FAILURE'), step('write_file', 'src/App.tsx', 'SUCCESS')]

    expect(isVerificationFailing(episodes, BUILD)).toBe(false)
  })

  it('stays true when the write was blocked, because nothing reached the disk', () => {
    const episodes = [step('run_command', BUILD, 'FAILURE'), step('write_file', 'src/App.tsx', 'BLOCKED')]

    expect(isVerificationFailing(episodes, BUILD)).toBe(true)
  })

  it('is false after the check passed', () => {
    const episodes = [step('run_command', BUILD, 'FAILURE'), step('run_command', BUILD, 'SUCCESS')]

    expect(isVerificationFailing(episodes, BUILD)).toBe(false)
  })

  it('matches the command loosely, since the model does not retype it identically', () => {
    expect(isVerificationFailing([step('run_command', 'npm run build --silent', 'FAILURE')], BUILD)).toBe(true)
  })

  it('ignores other failing commands', () => {
    expect(isVerificationFailing([step('run_command', 'npm install left-pad', 'FAILURE')], BUILD)).toBe(false)
  })

  it('says nothing when the project declares no check', () => {
    expect(isVerificationFailing([step('run_command', BUILD, 'FAILURE')], null)).toBe(false)
  })

  it('reads the most recent attempt, not the first', () => {
    const episodes = [
      step('run_command', BUILD, 'FAILURE'),
      step('write_file', 'src/App.tsx', 'SUCCESS'),
      step('run_command', BUILD, 'FAILURE'),
    ]

    expect(isVerificationFailing(episodes, BUILD)).toBe(true)
  })
})

describe('buildVerificationFailingDirective', () => {
  it('forbids the re-run', () => {
    expect(buildVerificationFailingDirective(BUILD)).toContain('DO NOT RUN IT AGAIN YET')
  })

  it('does NOT prescribe the fix, because it cannot know what the fix is', () => {
    // The bug this replaced: it ordered `write_file` on "the first file the output names",
    // assuming every compiler error is corrected by editing that file. Measured 2026-08-25,
    // steps 40-48: the error was a missing `@types/react`, the tool result said so correctly
    // four times, and this directive overrode it from the channel that always wins.
    const directive = buildVerificationFailingDirective(BUILD)

    expect(directive).not.toContain('MUST be "write_file"')
    expect(directive).not.toContain('MUST be "run_command"')
  })

  it('defers to the one directive that does know', () => {
    const directive = buildVerificationFailingDirective(BUILD)

    expect(directive).toContain('recent tool results above')
    expect(directive).toContain('It is the only instruction that applies right now')
  })

  it('does not restate the compiler errors', () => {
    expect(buildVerificationFailingDirective(BUILD)).not.toMatch(/error TS\d+/)
  })

  it('says why running it again proves nothing', () => {
    expect(buildVerificationFailingDirective(BUILD)).toContain('reads the code, it does not change it')
  })
})

/**
 * The directive used to point at a diagnostic instead of carrying it: "do what that directive
 * says", meaning one sitting in the tool history. Measured 2026-08-25T20:24, the model could not
 * follow the indirection — steps 34 to 50 were seventeen blocked reissues of a `write_file` on
 * src/index.html, to the ceiling, while this text told it to consult something elsewhere.
 *
 * The two channels have different lifetimes. The plan block is rebuilt from live state every
 * turn; the tool result it referred to lives in the history block and ages out of it. A pointer
 * across that boundary can dangle, and nothing tells the model when it has.
 */
describe('buildVerificationFailingDirective — carrying the diagnostic', () => {
  const BUILD_CMD = 'npm run build'
  const DIAGNOSTIC = [
    '[THE COMPILER NAMED THE FILE AND THE LINE — FIX THAT FILE]',
    'Directives:',
    '1. Your next tool call MUST be "write_file" on "src/App.tsx".',
  ].join('\n')

  it('embeds the diagnostic rather than referring to it', () => {
    const directive = buildVerificationFailingDirective(BUILD_CMD, DIAGNOSTIC)
    expect(directive).toContain('THE COMPILER NAMED THE FILE AND THE LINE')
    expect(directive).toContain('"write_file" on "src/App.tsx"')
    // The pointer, and the instruction to go and resolve it, are gone.
    expect(directive).not.toContain('recent tool results above')
    expect(directive).not.toContain('Do what that directive says')
  })

  it('still forbids re-running the check before something changes', () => {
    const directive = buildVerificationFailingDirective(BUILD_CMD, DIAGNOSTIC)
    expect(directive).toContain('DO NOT RUN IT AGAIN YET')
    expect(directive).toContain('only after the above has actually changed a file')
  })

  it('carries exactly one prescription — the diagnostic\'s own', () => {
    const directive = buildVerificationFailingDirective(BUILD_CMD, DIAGNOSTIC)
    // The rule this module records: two places must never both prescribe the next action. What
    // changed is which channel delivers the single prescription, not how many there are.
    expect(directive.split('\n').filter((l) => /^\d+\. /.test(l))).toHaveLength(1)
  })

  it('falls back to the pointer when there is no diagnostic to carry', () => {
    const directive = buildVerificationFailingDirective(BUILD_CMD, null)
    expect(directive).toContain('recent tool results above')
    expect(directive).toContain('Do what that directive says')
  })
})
