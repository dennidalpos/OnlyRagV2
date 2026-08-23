import crypto from 'node:crypto'
import type { AgentToolCall } from './agentTypes'

/**
 * How the previous invocations of a repeated action actually ended.
 * `unknown` covers actions the executor never reported an outcome for (the very first
 * repeat inside a single turn, or non-executing pseudo-tools).
 */
export type RepeatOutcomeKind = 'succeeding' | 'failing' | 'unknown'

export interface LoopCheckResult {
  isLooping: boolean
  consecutiveDuplicateCount: number
  suggestedIntervention?: string
  /**
   * Only meaningful when `isLooping` is true. Repeating a command that KEEPS SUCCEEDING is a
   * different failure from repeating one that keeps failing: the work is done, the model just
   * isn't moving on. The caller must not punish it as stagnation — see handleLoopDetection.
   */
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

/**
 * Fingerprints agent tool invocations and tracks target-level semantic patterns
 * to detect and prevent infinite loops, oscillation traps, and redundant read loops.
 */
export class AgentActionLoopDetector {
  private signatureHistory: string[] = []
  private targetHistory: TargetActionRecord[] = []
  private actionSequence: string[] = []
  /** Execution outcomes keyed by fingerprint, fed back by the orchestrator after each tool runs. */
  private outcomeBySignature = new Map<string, SignatureOutcomeRecord>()
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

  /**
   * Feeds the real execution outcome of a previously recorded tool call back into the detector.
   * Without this the detector only ever sees INTENT, so it cannot tell a model hammering a
   * broken command from one re-running a command that works — the two need opposite responses.
   * Called by the orchestrator once the tool has actually run.
   */
  public recordOutcome(toolCall: AgentToolCall, succeeded: boolean): void {
    const signature = this.generateFingerprint(toolCall)
    const previous = this.outcomeBySignature.get(signature)
    this.outcomeBySignature.set(signature, {
      successes: (previous?.successes || 0) + (succeeded ? 1 : 0),
      failures: (previous?.failures || 0) + (succeeded ? 0 : 1),
      lastSucceeded: succeeded,
    })
  }

  /** Classifies a repeat by how its previous executions ended. */
  public classifyRepeatOutcome(toolCall: AgentToolCall): RepeatOutcomeKind {
    const record = this.outcomeBySignature.get(this.generateFingerprint(toolCall))
    if (!record) return 'unknown'
    return record.lastSucceeded ? 'succeeding' : 'failing'
  }

  /**
   * Records a tool call and checks for exact fingerprint repeats, semantic edit oscillations,
   * and redundant read loops.
   */
  public recordAndCheck(toolCall: AgentToolCall): LoopCheckResult {
    const signature = this.generateFingerprint(toolCall)
    this.signatureHistory.push(signature)

    const target = this.extractTarget(toolCall)
    this.targetHistory.push({ tool: toolCall.tool, target })

    // 0.5 Shell-Command Tool-Keyword Loop Check:
    // Detects when the model repeatedly passes a tool name as a shell command
    // (e.g. `write_file "path" '...'`) across consecutive run_command calls.
    // The fingerprint check (section 1) misses this when the JSON payload varies
    // slightly between iterations. This check operates on the raw command string.
    const SHELL_TOOL_KEYWORDS = [
      'write_file', 'read_file', 'replace_file_content', 'multi_replace_file_content',
      'delete_file', 'list_dir', 'list_files_recursive', 'grep_search',
      'extract_code_symbols', 'create_directory', 'copy_file', 'move_file',
      'web_search', 'fetch_web_content', 'download_file', 'inspect_os_env',
      'ask', 'finish',
    ]
    if (toolCall.tool === 'run_command' && toolCall.parameters?.command) {
      const rawCmd = String(toolCall.parameters.command).trimStart()
      const matchedKeyword = SHELL_TOOL_KEYWORDS.find((kw) => rawCmd.startsWith(kw))
      if (matchedKeyword) {
        const recentRunCmds = this.targetHistory.slice(-5)
        const consecutiveToolKeywordCmds = recentRunCmds.filter(
          (rec) => rec.tool === 'run_command' && rec.target?.trimStart().startsWith(matchedKeyword)
        ).length
        if (consecutiveToolKeywordCmds >= 2) {
          return {
            isLooping: true,
            consecutiveDuplicateCount: consecutiveToolKeywordCmds + 1,
            suggestedIntervention: [
              `[CRITICAL SHELL-TOOL CONFUSION LOOP: "${matchedKeyword}" PASSED AS SHELL COMMAND ${consecutiveToolKeywordCmds + 1} TIMES]`,
              `"${matchedKeyword}" is a STRUCTURED TOOL — it is NOT a shell executable.`,
              `You MUST stop passing it to run_command immediately.`,
              `Directives:`,
              `1. Invoke "${matchedKeyword}" as a JSON tool call (NOT inside run_command).`,
              `2. Correct format:`,
              `\`\`\`json`,
              `{ "tool": "${matchedKeyword}", "parameters": { ... }, "explanation": "..." }`,
              `\`\`\``,
              `3. Do NOT wrap tool calls inside run_command, shell, or any terminal string.`,
            ].join('\n'),
          }
        }
      }
    }

    // 1. Exact parameter repeat check (last 5 steps)
    const recentSignatures = this.signatureHistory.slice(-5)
    const duplicateCount = recentSignatures.filter((sig) => sig === signature).length

    if (duplicateCount > this.maxRepeatsAllowed) {
      const repeatOutcome = this.classifyRepeatOutcome(toolCall)
      const record = this.outcomeBySignature.get(signature)

      // A repeat whose previous runs SUCCEEDED needs the opposite advice: there is no error to
      // investigate and no alternative approach to find — the action already did its job and
      // its effect is on disk. Telling such a model to "investigate the error stack trace"
      // sends it looking for a failure that never happened.
      const suggestedIntervention = repeatOutcome === 'succeeding'
        ? `[REDUNDANT ACTION: "${toolCall.tool}" ALREADY SUCCEEDED ${record?.successes || 1} TIME(S)]\nYou have re-issued the exact same "${toolCall.tool}" call ${duplicateCount} times. Every previous execution SUCCEEDED — nothing is broken and there is no error to fix.\nIts effect is ALREADY applied${target ? ` to "${target}"` : ''}: re-running it changes nothing and wastes a step.\nDirectives:\n1. Treat this action as DONE and move to the NEXT unfinished step of your active milestone.\n2. If the milestone's deliverable is already in place, run its verification command via run_command, then mark it with update_plan.\n3. If every milestone is complete and verified, invoke the "finish" tool with your final report.`
        : `[CRITICAL LOOP INTERVENTION: REPEATED ACTION DETECTED]\nYou have attempted the exact same "${toolCall.tool}" action ${duplicateCount} times without progressing.\nDO NOT repeat this tool call with the same parameters.\nDirectives:\n1. If a file edit or replace failed, read the file first to inspect exact lines and whitespace.\n2. If a command or build failed, investigate the error stack trace and try an alternative approach.\n3. If you are stuck or require human guidance, use the "ask" tool to explain the blocker.`

      return {
        isLooping: true,
        consecutiveDuplicateCount: duplicateCount,
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
        suggestedIntervention: cycleRes.suggestedDirective,
      }
    }

    // 2. File Edit Thrashing Check: >=4 edit-class operations on the same file within the last 6 actions.
    // Gives the agent runway for legitimate multi-step edits (create, import patch, style patch)
    // while catching infinite mutation loops.
    if (target && ['replace_file_content', 'multi_replace_file_content', 'write_file'].includes(toolCall.tool)) {
      const recentTargets = this.targetHistory.slice(-6)
      const sameFileEdits = recentTargets.filter(
        (rec) => rec.target === target && ['replace_file_content', 'multi_replace_file_content', 'write_file'].includes(rec.tool)
      ).length

      if (sameFileEdits >= 4) {
        const isConfigFile = /(package\.json|tsconfig\.json|vite\.config|requirements\.txt|pyproject\.toml|Cargo\.toml|go\.mod)$/i.test(target)
        const configDirectives = isConfigFile
          ? `\n3. The file "${target}" is ALREADY created on disk. DO NOT edit "${target}" again. Proceed IMMEDIATELY to implementing source code components in src/ (e.g. src/App.tsx, components, pages) or use update_plan.`
          : ''

        return {
          isLooping: true,
          consecutiveDuplicateCount: sameFileEdits,
          suggestedIntervention: `[CRITICAL FILE EDIT LOOP: ${sameFileEdits} EDITS ON ${target} WITHOUT VERIFICATION]\nYou have executed ${sameFileEdits} edit operations (write_file/replace_file_content/multi_replace_file_content) on "${target}" in a row, without verifying any of them.\nDO NOT edit "${target}" again in your next step.\nDirectives:\n1. Execute a build, test, or typecheck command via run_command (e.g. npm run build, npm test, npm run typecheck) to verify syntax and runtime integrity.\n2. If your implementation is complete and verified, invoke the finish tool immediately.${configDirectives}`,
        }
      }
    }

    // 3. Consecutive Read Loop Check: >=4 consecutive read/inspect calls on same target without action
    if (target && ['read_file', 'list_dir', 'grep_search', 'extract_code_symbols'].includes(toolCall.tool)) {
      const recentTargets = this.targetHistory.slice(-5)
      const consecutiveReads = recentTargets.filter(
        (rec) => rec.target === target && ['read_file', 'list_dir', 'grep_search', 'extract_code_symbols'].includes(rec.tool)
      ).length

      if (consecutiveReads >= 4) {
        return {
          isLooping: true,
          consecutiveDuplicateCount: consecutiveReads,
          suggestedIntervention: `[CRITICAL READ LOOP INTERVENTION: REPEATED READS ON ${target}]\nYou have called read/inspect tools on "${target}" ${consecutiveReads} consecutive times without making any file changes or running commands.\nDO NOT call read_file or list_dir again on this target.\nDirectives:\n1. The file contents are ALREADY visible in your RECENT DETAILED TOOL OUTPUTS.\n2. Proceed IMMEDIATELY with write_file, replace_file_content, or run_command to make progress.\n3. If you have completed all changes, execute your verification build/test command or call finish.`,
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
  public recordAndDetectCycle(toolName: string, params: Record<string, any>): CycleDetectionResult {
    const target = params.filePath || params.command || params.targetContent || params.url || ''
    const actionKey = `${toolName}:${target}`
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
            suggestedDirective: `[OSCILLATION DETECTED] You are trapped in an oscillating loop of length ${k}. You MUST STOP repeating these edits. Re-read the target file with read_file, run a test command with run_command, or re-evaluate your plan strategy.`,
          }
        }
      }
    }

    return { isOscillating: false }
  }

  /**
   * Resets history for a specific target or all targets.
   * Call this after an intervention is issued so that the model's next attempt
   * to fix/modify the target file is evaluated cleanly against the new strategy.
   *
   * Outcome memory is deliberately kept: "this exact command succeeded" stays true after the
   * plan moves on, and forgetting it would let the next repeat be misread as a failing loop.
   */
  public resetTarget(target?: string): void {
    this.signatureHistory = []
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
    this.targetHistory = []
    this.actionSequence = []
    this.outcomeBySignature.clear()
  }

  /**
   * Returns current history length.
   */
  public get historyLength(): number {
    return this.signatureHistory.length
  }
}
