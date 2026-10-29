import type { UntrustedJson } from '../../../../shared/types'
import crypto from 'node:crypto'
import type { AgentToolCall } from './agentTypes'
import { renderAdviceSteps } from './diagnosticAdvice'

/** How the previous invocations of a repeated action actually ended. */
export type RepeatOutcomeKind = 'succeeding' | 'failing' | 'unknown'

/** Which repetition pattern tripped the detector. */
export type LoopPattern = 'exact_repeat' | 'unchanged_failing_repeat' | 'cycle' | 'same_file_edits' | 'same_target_reads'

export interface LoopCheckResult {
  isLooping: boolean
  consecutiveDuplicateCount: number
  /** Set whenever `isLooping` is true. */
  pattern?: LoopPattern
  suggestedIntervention?: string
  /** Only meaningful when `isLooping` is true. */
  repeatOutcome?: RepeatOutcomeKind
}

export interface CycleDetectionResult {
  isOscillating: boolean
  cycleLength?: number
  suggestedDirective?: string
}

interface TargetActionRecord {
  tool: string
  target?: string
}

interface SignatureOutcomeRecord {
  successes: number
  failures: number
  /** The outcome of the most recent execution: a command that worked twice and then broke
   *  is a failing repeat, not a redundant one. */
  lastSucceeded: boolean
}

/** Tools that re-run a check: rerunning one that failed, with nothing changed since, reproduces the failure. */
const CHECK_TOOLS = new Set(['run_command', 'run_tests'])
/** Tools whose execution can change what a check sees (a failed command may still write or install). */
const STATE_CHANGING_TOOLS = new Set([
  'write_file',
  'replace_file_content',
  'multi_replace_file_content',
  'delete_file',
  'copy_file',
  'move_file',
  'create_directory',
  'download_file',
  'ensure_tool',
  'git_commit',
  'run_command',
  'run_tests',
])

function accumulate(previous: SignatureOutcomeRecord | undefined, succeeded: boolean): SignatureOutcomeRecord {
  return {
    successes: (previous?.successes || 0) + (succeeded ? 1 : 0),
    failures: (previous?.failures || 0) + (succeeded ? 0 : 1),
    lastSucceeded: succeeded,
  }
}

/** Edit tools monitored for modification oscillations. */
const EDIT_TOOLS = new Set(['write_file', 'replace_file_content', 'multi_replace_file_content'])

export class AgentActionLoopDetector {
  private signatureHistory: string[] = []
  private targetHistory: TargetActionRecord[] = []
  private actionSequence: string[] = []
  /** Execution outcomes keyed by fingerprint, fed back by the orchestrator after each tool runs. */
  private outcomeBySignature = new Map<string, SignatureOutcomeRecord>()
  /** Tracks execution outcomes keyed by target path to support redundant-success exemptions across varied edits. */
  private outcomeByTarget = new Map<string, SignatureOutcomeRecord>()
  /** Bumped by every execution that may have changed the workspace. */
  private workspaceEpoch = 0
  /** Workspace epoch at the last failure of each check, keyed by fingerprint. */
  private failedCheckEpoch = new Map<string, number>()
  /** Bumped only by successful non-check mutations (file edits, deletes, downloads...). */
  private editEpoch = 0
  /** `editEpoch` when each entry of `signatureHistory` was recorded. */
  private signatureEditEpochs: number[] = []
  private readonly maxRepeatsAllowed: number
  private readonly maxHistoryLength = 20

  constructor(maxRepeatsAllowed = 2) {
    this.maxRepeatsAllowed = maxRepeatsAllowed
  }

  /**
   * Generates a deterministic SHA-256 fingerprint for a tool call.
   */
  public generateFingerprint(toolCall: AgentToolCall): string {
    const rawPayload = `${toolCall.tool}:${JSON.stringify(toolCall.parameters || {})}`
    return crypto.createHash('sha256').update(rawPayload).digest('hex')
  }

  private extractTarget(toolCall: AgentToolCall): string | undefined {
    return (
      toolCall.parameters?.filePath ||
      toolCall.parameters?.file_path ||
      toolCall.parameters?.dirPath ||
      toolCall.parameters?.dir_path ||
      toolCall.parameters?.path ||
      toolCall.parameters?.command ||
      toolCall.parameters?.url
    )
  }

  /** Feeds the real execution outcome of a previously recorded tool call back into the detector. */
  public recordOutcome(toolCall: AgentToolCall, succeeded: boolean): void {
    const signature = this.generateFingerprint(toolCall)
    this.outcomeBySignature.set(signature, accumulate(this.outcomeBySignature.get(signature), succeeded))

    const target = this.extractTarget(toolCall)
    if (target) {
      this.outcomeByTarget.set(target, accumulate(this.outcomeByTarget.get(target), succeeded))
    }

    const isCheck = CHECK_TOOLS.has(toolCall.tool)
    if (STATE_CHANGING_TOOLS.has(toolCall.tool) && (succeeded || isCheck)) this.workspaceEpoch++
    if (!isCheck && succeeded && STATE_CHANGING_TOOLS.has(toolCall.tool)) this.editEpoch++
    if (!isCheck) return
    if (succeeded) this.failedCheckEpoch.delete(signature)
    else this.failedCheckEpoch.set(signature, this.workspaceEpoch)
  }

  /** True when this exact check failed last time and nothing that could change its result ran since. */
  private isUnchangedFailingCheck(toolCall: AgentToolCall, signature: string): boolean {
    return CHECK_TOOLS.has(toolCall.tool) && this.failedCheckEpoch.get(signature) === this.workspaceEpoch
  }

  /** Classifies a repeat by how its previous executions ended. */
  public classifyRepeatOutcome(toolCall: AgentToolCall): RepeatOutcomeKind {
    const bySignature = this.outcomeBySignature.get(this.generateFingerprint(toolCall))
    if (bySignature) return bySignature.lastSucceeded ? 'succeeding' : 'failing'

    const target = this.extractTarget(toolCall)
    const byTarget = target ? this.outcomeByTarget.get(target) : undefined
    if (byTarget) return byTarget.lastSucceeded ? 'succeeding' : 'failing'

    return 'unknown'
  }

  /**
   * Records a tool call and checks for exact fingerprint repeats, semantic edit oscillations,
   * and redundant read loops.
   */
  public recordAndCheck(toolCall: AgentToolCall): LoopCheckResult {
    const signature = this.generateFingerprint(toolCall)
    this.signatureHistory.push(signature)
    this.signatureEditEpochs.push(this.editEpoch)

    const target = this.extractTarget(toolCall)
    this.targetHistory.push({ tool: toolCall.tool, target })

    // 1. Exact parameter repeat check
    // A build or test re-run after a successful edit is the normal fix cycle (edit, build, edit,
    // build), not a repeat: for checks only runs since the last edit count as duplicates.
    const recentSignatures = this.signatureHistory.slice(-5)
    const recentEpochs = this.signatureEditEpochs.slice(-5)
    const duplicateCount = recentSignatures.filter(
      (sig, index) => sig === signature && (!CHECK_TOOLS.has(toolCall.tool) || recentEpochs[index] === this.editEpoch),
    ).length

    // Block unchanged failing check to avoid wasting execution budget
    if (this.isUnchangedFailingCheck(toolCall, signature)) {
      return {
        isLooping: true,
        consecutiveDuplicateCount: duplicateCount,
        pattern: 'unchanged_failing_repeat',
        repeatOutcome: 'failing',
        suggestedIntervention: renderAdviceSteps(
          `[UNCHANGED RETRY BLOCKED: "${target || toolCall.tool}" FAILED AND NOTHING HAS CHANGED SINCE]`,
          ['This exact call failed on its last run, and no file edit or command has run after it, so it would fail again the same way. It was NOT executed.'],
          [
            'Read the error in your RECENT DETAILED TOOL OUTPUTS and the suggested fix attached to it.',
            'Apply the fix it names with write_file or replace_file_content (read the file first if you need its current content).',
            'Then run this call again: after a real change it is allowed.',
          ],
        ),
      }
    }

    if (duplicateCount > this.maxRepeatsAllowed) {
      const repeatOutcome = this.classifyRepeatOutcome(toolCall)
      const record = this.outcomeBySignature.get(signature)

      // A repeat whose previous runs SUCCEEDED needs the opposite advice: there is no error to investigate and no alternative approach to find — the action already did its job and its effect is on disk.
      const suggestedIntervention =
        repeatOutcome === 'succeeding'
          ? renderAdviceSteps(
              `[REDUNDANT ACTION: "${toolCall.tool}" ALREADY SUCCEEDED ${record?.successes || 1} TIME(S)]`,
              [
                `You have re-issued the exact same "${toolCall.tool}" call ${duplicateCount} times. Every previous execution SUCCEEDED — nothing is broken and there is no error to fix.`,
                `Its effect is ALREADY applied${target ? ` to "${target}"` : ''}: re-running it changes nothing and wastes a step.`,
              ],
              [
                'Treat this action as DONE and move to the NEXT unfinished step of your active milestone.',
                "If the milestone's deliverable is already in place, run its verification command via run_command, then mark it with update_plan.",
                'If every milestone is complete and verified, invoke the "finish" tool with your final report.',
              ],
            )
          : renderAdviceSteps(
              '[CRITICAL LOOP INTERVENTION: REPEATED ACTION DETECTED]',
              [
                `You have attempted the exact same "${toolCall.tool}" action ${duplicateCount} times without progressing.`,
                'Repeating this tool call with the same parameters will not progress.',
              ],
              [
                'If a file edit or replace failed, read the file first to inspect exact lines and whitespace.',
                'If a command or build failed, investigate the error stack trace and try an alternative approach.',
                'If you are stuck or require human guidance, use the "ask" tool to explain the blocker.',
              ],
            )

      return {
        isLooping: true,
        consecutiveDuplicateCount: duplicateCount,
        pattern: 'exact_repeat',
        suggestedIntervention,
        repeatOutcome,
      }
    }

    // 1.5 Multi-step Cycle Oscillation Check (k-mer cycle detection)
    const cycleRes = this.recordAndDetectCycle(toolCall.tool, toolCall.parameters || {})
    if (cycleRes.isOscillating) {
      return {
        isLooping: true,
        consecutiveDuplicateCount: cycleRes.cycleLength || 2,
        pattern: 'cycle',
        suggestedIntervention: cycleRes.suggestedDirective,
      }
    }

    // 2.
    if (target && ['replace_file_content', 'multi_replace_file_content', 'write_file'].includes(toolCall.tool)) {
      // Edits "without verification" end at the last check: counted across it, a build run between
      // two corrections kept the window full of package.json edits and blocked every later
      // correction for 25 steps (live full task run 23 of 2026-09-24).
      const lastCheck = this.targetHistory.map((rec) => CHECK_TOOLS.has(rec.tool)).lastIndexOf(true)
      const recentTargets = this.targetHistory.slice(lastCheck + 1).slice(-6)
      const sameFileEdits = recentTargets.filter(
        (rec) => rec.target === target && ['replace_file_content', 'multi_replace_file_content', 'write_file'].includes(rec.tool),
      ).length

      if (sameFileEdits >= 4) {
        const isConfigFile = /(package\.json|tsconfig\.json|vite\.config|requirements\.txt|pyproject\.toml|Cargo\.toml|go\.mod)$/i.test(target)
        const configStep = isConfigFile
          ? [
              `The file "${target}" is ALREADY created on disk: leave it as it is and continue with the source code components in src/ (e.g. src/App.tsx, components, pages) or use update_plan.`,
            ]
          : []

        return {
          isLooping: true,
          consecutiveDuplicateCount: sameFileEdits,
          pattern: 'same_file_edits',
          suggestedIntervention: renderAdviceSteps(
            `[CRITICAL FILE EDIT LOOP: ${sameFileEdits} EDITS ON ${target} WITHOUT VERIFICATION]`,
            [
              `You have executed ${sameFileEdits} edit operations (write_file/replace_file_content/multi_replace_file_content) on "${target}" in a row, without verifying any of them.`,
            ],
            [
              `Execute a build, test, or typecheck command via run_command (e.g. npm run build, npm test, npm run typecheck) to verify syntax and runtime integrity before editing "${target}" again.`,
              'If your implementation is complete and verified, invoke the finish tool.',
              ...configStep,
            ],
          ),
          // Edits that all landed are redundancy, not stagnation: the file exists and the milestone is reachable.
          repeatOutcome: this.classifyRepeatOutcome(toolCall),
        }
      }
    }

    // 3.
    if (target && ['read_file', 'list_dir', 'grep_search', 'extract_code_symbols'].includes(toolCall.tool)) {
      const recentTargets = this.targetHistory.slice(-5)
      const consecutiveReads = recentTargets.filter(
        (rec) => rec.target === target && ['read_file', 'list_dir', 'grep_search', 'extract_code_symbols'].includes(rec.tool),
      ).length

      if (consecutiveReads >= 4) {
        return {
          isLooping: true,
          consecutiveDuplicateCount: consecutiveReads,
          pattern: 'same_target_reads',
          suggestedIntervention: renderAdviceSteps(
            `[CRITICAL READ LOOP INTERVENTION: REPEATED READS ON ${target}]`,
            [
              `You have called read/inspect tools on "${target}" ${consecutiveReads} consecutive times without making any file changes or running commands.`,
              'The file contents are ALREADY visible in your RECENT DETAILED TOOL OUTPUTS: another read_file or list_dir on this target shows nothing new.',
            ],
            [
              'Continue with write_file, replace_file_content, or run_command to make progress.',
              'If you have completed all changes, execute your verification build/test command or call finish.',
            ],
          ),
        }
      }
    }

    return {
      isLooping: false,
      consecutiveDuplicateCount: duplicateCount,
    }
  }

  /**
   * Detects multi-step cycle oscillations (e.g. A -> B -> A -> B or A -> B -> C -> A -> B -> C).
   */
  public recordAndDetectCycle(toolName: string, params: Record<string, UntrustedJson>): CycleDetectionResult {
    const target = params.filePath || params.command || params.targetContent || params.url || ''
    // An edit is keyed by what it writes too: "fix, build, different fix, build" is a correction in
    // progress, not an oscillation. Keyed by path alone, live full task run 21 of 2026-09-24 had the
    // one correct stylesheet rewrite blocked as a cycle three times. Identical edits still match.
    const contentKey = EDIT_TOOLS.has(toolName) ? `:${crypto.createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 16)}` : ''
    const actionKey = `${toolName}:${target}${contentKey}`
    this.actionSequence.push(actionKey)

    if (this.actionSequence.length > this.maxHistoryLength) {
      this.actionSequence.shift()
    }

    const n = this.actionSequence.length
    for (let k = 2; k <= 4; k++) {
      if (n >= k * 2) {
        const pattern1 = this.actionSequence.slice(n - k).join('|')
        const pattern2 = this.actionSequence.slice(n - 2 * k, n - k).join('|')
        const hasDistinctActions = new Set(this.actionSequence.slice(n - k)).size > 1

        if (pattern1 === pattern2 && hasDistinctActions) {
          return {
            isOscillating: true,
            cycleLength: k,
            suggestedDirective: renderAdviceSteps(
              '[OSCILLATION DETECTED]',
              [`You are trapped in an oscillating loop of length ${k}: repeating these edits only restores a state you already had.`],
              ['Re-read the target file with read_file, run a test command with run_command, or re-evaluate your plan strategy.'],
            ),
          }
        }
      }
    }

    return { isOscillating: false }
  }

  /** Resets history for a specific target or all targets. */
  public resetTarget(target?: string): void {
    this.signatureHistory = []
    this.signatureEditEpochs = []
    if (!target) {
      this.targetHistory = []
      return
    }
    this.targetHistory = this.targetHistory.filter((rec) => rec.target !== target)
  }

  /**
   * Resets signature, target, cycle history and recorded outcomes.
   */
  public reset(): void {
    this.signatureHistory = []
    this.signatureEditEpochs = []
    this.editEpoch = 0
    this.targetHistory = []
    this.actionSequence = []
    this.outcomeBySignature.clear()
    this.outcomeByTarget.clear()
    this.failedCheckEpoch.clear()
    this.workspaceEpoch = 0
  }

  /**
   * Returns current history length.
   */
  public get historyLength(): number {
    return this.signatureHistory.length
  }
}
