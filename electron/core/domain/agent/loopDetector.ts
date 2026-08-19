import crypto from 'node:crypto'
import type { AgentToolCall } from './agentTypes'
import { CycleOscillationDetectorAndReproOracle } from './cycleOscillationDetector'

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
  private cycleDetector = new CycleOscillationDetectorAndReproOracle()
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
      return {
        isLooping: true,
        consecutiveDuplicateCount: duplicateCount,
        suggestedIntervention: `[CRITICAL LOOP INTERVENTION: REPEATED ACTION DETECTED]\nYou have attempted the exact same "${toolCall.tool}" action ${duplicateCount} times without progressing.\nDO NOT repeat this tool call with the same parameters.\nDirectives:\n1. If a file edit or replace failed, read the file first to inspect exact lines and whitespace.\n2. If a command or build failed, investigate the error stack trace and try an alternative approach.\n3. If you are stuck or require human guidance, use the "ask" tool to explain the blocker.`,
      }
    }

    // 1.5 Multi-step Cycle Oscillation Check (k-mer cycle detection)
    const cycleRes = this.cycleDetector.recordAndDetectCycle(toolCall.tool, toolCall.parameters || {})
    if (cycleRes.isOscillating) {
      return {
        isLooping: true,
        consecutiveDuplicateCount: cycleRes.cycleLength || 2,
        suggestedIntervention: cycleRes.suggestedDirective,
      }
    }

    // 2. File Edit Thrashing Check: >=2 edit-class operations (write_file, replace_file_content,
    // multi_replace_file_content) on the same file within the last 4 actions. This used to be two
    // separate, overlapping checks -- a looser "3 edits in 6" rule covering all three tools and a
    // stricter "2 write_file's in 4" rule covering only write_file -- which meant a real stuck
    // session could ride out whichever threshold happened to be slower to fire. One tool-agnostic,
    // fast-firing rule is both simpler and harder to dodge.
    if (target && ['replace_file_content', 'multi_replace_file_content', 'write_file'].includes(toolCall.tool)) {
      const recentTargets = this.targetHistory.slice(-4)
      const sameFileEdits = recentTargets.filter(
        (rec) => rec.target === target && ['replace_file_content', 'multi_replace_file_content', 'write_file'].includes(rec.tool)
      ).length

      if (sameFileEdits >= 2) {
        return {
          isLooping: true,
          consecutiveDuplicateCount: sameFileEdits,
          suggestedIntervention: `[CRITICAL FILE EDIT LOOP: ${sameFileEdits} EDITS ON ${target} WITHOUT VERIFICATION]\nYou have executed ${sameFileEdits} edit operations (write_file/replace_file_content/multi_replace_file_content) on "${target}" in a row, without verifying any of them.\nDO NOT edit "${target}" again in your next step.\nDirectives:\n1. Execute a build, test, or typecheck command via run_command (e.g. npm run build, npm test, npm run typecheck) to verify syntax and runtime integrity.\n2. If your implementation is complete and verified, invoke the finish tool immediately.`,
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
