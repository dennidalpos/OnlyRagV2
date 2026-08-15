import crypto from 'node:crypto'
import type { AgentToolCall } from './agentTypes'

export interface LoopCheckResult {
  isLooping: boolean
  consecutiveDuplicateCount: number
  suggestedIntervention?: string
}

interface TargetActionRecord {
  tool: string
  target?: string
}

/**
 * Fingerprints agent tool invocations and tracks target-level semantic patterns
 * to detect and prevent infinite loops, oscillation traps, and redundant read loops.
 */
export class AgentActionLoopDetector {
  private signatureHistory: string[] = []
  private targetHistory: TargetActionRecord[] = []
  private readonly maxRepeatsAllowed: number

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
   * Records a tool call and checks for exact fingerprint repeats, semantic edit oscillations,
   * and redundant read loops.
   */
  public recordAndCheck(toolCall: AgentToolCall): LoopCheckResult {
    const signature = this.generateFingerprint(toolCall)
    this.signatureHistory.push(signature)

    const target = this.extractTarget(toolCall)
    this.targetHistory.push({ tool: toolCall.tool, target })

    // 1. Exact parameter repeat check (last 5 steps)
    const recentSignatures = this.signatureHistory.slice(-5)
    const duplicateCount = recentSignatures.filter((sig) => sig === signature).length

    if (duplicateCount > this.maxRepeatsAllowed) {
      return {
        isLooping: true,
        consecutiveDuplicateCount: duplicateCount,
        suggestedIntervention: `[CRITICAL LOOP INTERVENTION: REPEATED ACTION DETECTED]\nYou have attempted the exact same "${toolCall.tool}" action ${duplicateCount} times without progressing.\nDO NOT repeat this tool call with the same parameters.\nDirectives:\n1. If a file edit or replace failed, read the file first to inspect exact lines and whitespace.\n2. If a command or build failed, investigate the error stack trace and try an alternative approach.\n3. If you are stuck or require human guidance, use the "ask" tool to explain the blocker.`,
      }
    }

    // 2. Semantic File Edit Oscillation Check (e.g. >=3 edit/replace attempts on the same file in the last 6 actions)
    if (target && ['replace_file_content', 'multi_replace_file_content', 'write_file'].includes(toolCall.tool)) {
      const recentTargets = this.targetHistory.slice(-6)
      const sameFileEdits = recentTargets.filter(
        (rec) => rec.target === target && ['replace_file_content', 'multi_replace_file_content', 'write_file'].includes(rec.tool)
      ).length

      if (sameFileEdits >= 3) {
        return {
          isLooping: true,
          consecutiveDuplicateCount: sameFileEdits,
          suggestedIntervention: `[CRITICAL OSCILLATION INTERVENTION: FILE EDIT CONVERGENCE REQUIRED FOR ${target}]\nYou have executed ${sameFileEdits} edit operations on "${target}".\nDO NOT edit "${target}" again in your next step.\nDirectives:\n1. Execute a build, test, or typecheck command via run_command (e.g. npm run build, npm test, npm run typecheck) to verify syntax and runtime integrity.\n2. If all code changes in the workspace are complete and verified, invoke the finish tool immediately.`,
        }
      }
    }

    // 2.5 Redundant Full Write Loop Check (e.g. >=2 full write_file calls on same target)
    if (target && toolCall.tool === 'write_file') {
      const recentWrites = this.targetHistory.slice(-4).filter(
        (rec) => rec.target === target && rec.tool === 'write_file'
      ).length

      if (recentWrites >= 2) {
        return {
          isLooping: true,
          consecutiveDuplicateCount: recentWrites,
          suggestedIntervention: `[CRITICAL WRITE LOOP INTERVENTION: REPEATED FULL WRITES ON ${target}]\nYou have written full file replacements to "${target}" ${recentWrites} times.\nDO NOT call write_file on "${target}" again.\nDirectives:\n1. If you need to make targeted changes, use replace_file_content or multi_replace_file_content.\n2. Run a build/test verification command via run_command to verify your updates.\n3. If your implementation is complete, call the finish tool immediately.`,
        }
      }
    }

    // 3. Consecutive Read Loop Check (e.g. >=3 consecutive read/inspect calls on same target without action)
    if (target && ['read_file', 'list_dir', 'grep_search', 'extract_code_symbols'].includes(toolCall.tool)) {
      const recentTargets = this.targetHistory.slice(-4)
      const consecutiveReads = recentTargets.filter(
        (rec) => rec.target === target && ['read_file', 'list_dir', 'grep_search', 'extract_code_symbols'].includes(rec.tool)
      ).length

      if (consecutiveReads >= 3) {
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
   * Resets history for a specific target or all targets.
   * Call this after an intervention is issued so that the model's next attempt
   * to fix/modify the target file is evaluated cleanly against the new strategy.
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
   * Resets signature and target history.
   */
  public reset(): void {
    this.signatureHistory = []
    this.targetHistory = []
  }

  /**
   * Returns current history length.
   */
  public get historyLength(): number {
    return this.signatureHistory.length
  }
}
