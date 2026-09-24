/** The shape this module needs from a recorded step; matches EpisodicStepRecord. */
export interface TrajectoryStep {
  tool: string
  target?: string
  status: 'SUCCESS' | 'FAILURE' | 'BLOCKED'
}

/** Tools whose success means the workspace changed, so a past failure is no longer current. */
const MUTATING_TOOLS = new Set([
  'write_file',
  'replace_file_content',
  'multi_replace_file_content',
  'create_directory',
  'move_file',
  'copy_file',
  'delete_file',
])

/**
 * `npm test` and `npm t` run the same script as `npm run test`: treating them as different
 * commands let the arbiter re-order a check that had just failed (full-task run 6, 2026-09-24).
 */
export function canonicalCommand(command: string): string {
  return command
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/^npm (?:test|t)(?= |$)/, 'npm run test')
}

/** True when the project's own check has run, failed, and nothing has been written since. */
export function isVerificationFailing(episodes: readonly TrajectoryStep[], verificationCommand: string | null | undefined): boolean {
  if (!verificationCommand) return false
  const needle = canonicalCommand(verificationCommand)
  if (!needle) return false

  for (let i = (episodes?.length ?? 0) - 1; i >= 0; i--) {
    const step = episodes[i]
    if (step.status === 'SUCCESS' && MUTATING_TOOLS.has(step.tool)) return false
    if (step.tool !== 'run_command') continue
    const command = canonicalCommand(step.target || '')
    if (!command.includes(needle)) continue
    // A blocked call never ran: the last real run still decides. Returning false here flipped the
    // arbiter back to verification_due (run_command only) right after the loop guard refused an
    // unchanged rerun, so the ordered fix could not be written (live TS2305 run, 2026-09-23).
    if (step.status === 'BLOCKED') continue
    return step.status === 'FAILURE'
  }

  return false
}

/** What the model is told when the check has already run and failed. */
export function buildVerificationFailingDirective(
  verificationCommand: string,
  /**
   * The diagnostic directive built from the failing run, to be CARRIED here rather than referred
   * to. Null when none could be built, and the text then falls back to the pointer.
   */
  embeddedDirective: string | null = null,
): string {
  const head = [
    `[THE PROJECT CHECK ALREADY RAN AND FAILED — DO NOT RUN IT AGAIN YET]`,
    `"${verificationCommand}" has already been executed and reported errors, and nothing has changed since. Running it again will report the same errors: the command reads the code, it does not change it.`,
  ]

  // Carrying it beats pointing at it, and does not break the rule above: there is still exactly ONE prescription in the turn, and it is still the diagnostic's — the only thing that has read the compiler's own suggestion.
  if (embeddedDirective) {
    return [
      ...head,
      `This is what that failure requires:`,
      embeddedDirective,
      `Run "${verificationCommand}" again only after the above has actually changed a file.`,
    ].join('\n')
  }

  return [
    ...head,
    `Its output is in your recent tool results above, together with the directive that says exactly what to do about it — which file to write, or which command to run.`,
    `Directives:`,
    `1. Do what that directive says. It is the only instruction that applies right now.`,
    `2. Run "${verificationCommand}" again only after that has actually changed something.`,
  ].join('\n')
}
