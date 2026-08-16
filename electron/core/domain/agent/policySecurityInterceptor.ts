export type PolicyAction = 'ALLOW' | 'DENY' | 'REQUIRE_HUMAN_APPROVAL'

export interface PolicyDecision {
  action: PolicyAction
  reason?: string
}

export class PolicyBasedSecurityInterceptor {
  private static DANGEROUS_PATTERNS = [
    /rm -rf \//i,
    /drop database/i,
    /format-volume/i,
    /git push --force/i,
    /git reset --hard/i,
    /curl .* \| bash/i,
  ]

  /**
   * Evaluates security policy for a tool action against runtime mode and parameters.
   */
  public static evaluatePolicy(
    toolName: string,
    params: Record<string, any>,
    agentMode: 'plan' | 'ask' | 'agent'
  ): PolicyDecision {
    const cmdStr = (params.command || params.url || params.filePath || '').toLowerCase()

    // 1. Hard DENY for blacklisted destructive operations
    for (const pattern of this.DANGEROUS_PATTERNS) {
      if (pattern.test(cmdStr)) {
        return {
          action: 'DENY',
          reason: `Security Policy Gate: Operation matched forbidden pattern ${pattern}`,
        }
      }
    }

    // 2. Policy for ASK mode
    if (agentMode === 'ask') {
      const isMutating = ['run_command', 'write_file', 'replace_file_content', 'delete_file', 'download_file'].includes(toolName)
      if (isMutating) {
        return {
          action: 'REQUIRE_HUMAN_APPROVAL',
          reason: `ASK Mode Policy: Mutating tool "${toolName}" requires explicit user confirmation.`,
        }
      }
    }

    // 3. Policy for PLAN mode
    if (agentMode === 'plan') {
      const isMutating = ['run_command', 'write_file', 'replace_file_content', 'delete_file', 'download_file'].includes(toolName)
      if (isMutating) {
        return {
          action: 'DENY',
          reason: `PLAN Mode Policy: Mutating tool "${toolName}" is forbidden in read-only planning mode.`,
        }
      }
    }

    return { action: 'ALLOW' }
  }
}
