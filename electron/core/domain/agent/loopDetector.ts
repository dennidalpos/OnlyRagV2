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
 * to detect and prevent infinite loops and oscillation traps.
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
      toolCall.parameters?.path ||
      toolCall.parameters?.command ||
      toolCall.parameters?.url
    )
  }

  /**
   * Records a tool call and checks for exact fingerprint repeats and semantic target oscillations.
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

    // 2. Semantic File Edit Oscillation Check (e.g. >=3 replace attempts on the same file in the last 6 actions)
    if (target && ['replace_file_content', 'multi_replace_file_content'].includes(toolCall.tool)) {
      const recentTargets = this.targetHistory.slice(-6)
      const sameFileEdits = recentTargets.filter(
        (rec) => rec.target === target && ['replace_file_content', 'multi_replace_file_content'].includes(rec.tool)
      ).length

      if (sameFileEdits >= 3) {
        return {
          isLooping: true,
          consecutiveDuplicateCount: sameFileEdits,
          suggestedIntervention: `[CRITICAL OSCILLATION INTERVENTION: REPEATED EDITS ON ${target}]\nYou have attempted 3 or more consecutive replace operations on "${target}" without verifying convergence.\nDO NOT keep making micro-edits with replace_file_content.\nDirectives:\n1. Use read_file to inspect the entire enclosing section.\n2. If the file structure is disordered, use write_file to write the full corrected file content atomically.\n3. Run a build/test verification command via run_command to confirm syntax integrity.`,
        }
      }
    }

    return {
      isLooping: false,
      consecutiveDuplicateCount: duplicateCount,
    }
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
