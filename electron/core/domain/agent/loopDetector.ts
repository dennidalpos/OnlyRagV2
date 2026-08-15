import crypto from 'node:crypto'
import type { AgentToolCall } from './agentTypes'

export interface LoopCheckResult {
  isLooping: boolean
  consecutiveDuplicateCount: number
  suggestedIntervention?: string
}

/**
 * Fingerprints agent tool invocations to detect and prevent infinite loops and oscillation traps.
 */
export class AgentActionLoopDetector {
  private signatureHistory: string[] = []
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

  /**
   * Records a tool call fingerprint and checks for repetitive loop patterns.
   */
  public recordAndCheck(toolCall: AgentToolCall): LoopCheckResult {
    const signature = this.generateFingerprint(toolCall)
    this.signatureHistory.push(signature)

    // Analyze the last 5 executed steps
    const recentSignatures = this.signatureHistory.slice(-5)
    const duplicateCount = recentSignatures.filter((sig) => sig === signature).length

    if (duplicateCount > this.maxRepeatsAllowed) {
      return {
        isLooping: true,
        consecutiveDuplicateCount: duplicateCount,
        suggestedIntervention: `[CRITICAL LOOP INTERVENTION: REPEATED ACTION DETECTED]\nYou have attempted the exact same "${toolCall.tool}" action ${duplicateCount} times without progressing.\nDO NOT repeat this tool call with the same parameters.\nDirectives:\n1. If a file edit or replace failed, read the file first to inspect exact lines and whitespace.\n2. If a command or build failed, investigate the error stack trace and try an alternative approach.\n3. If you are stuck or require human guidance, use the "ask" tool to explain the blocker.`,
      }
    }

    return {
      isLooping: false,
      consecutiveDuplicateCount: duplicateCount,
    }
  }

  /**
   * Resets signature history.
   */
  public reset(): void {
    this.signatureHistory = []
  }

  /**
   * Returns current history length.
   */
  public get historyLength(): number {
    return this.signatureHistory.length
  }
}
