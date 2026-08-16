export type AgentRole = 'PLANNER' | 'EXPLORER' | 'CODER' | 'VERIFIER'

export interface AgentGraphState {
  currentRole: AgentRole
  userGoal: string
  planMilestones: string[]
  completedMilestones: string[]
  inspectedFiles: Map<string, string>
  modifiedFiles: Set<string>
  lastTestFailure?: string
}

export class RoleBasedAgentGraphOrchestrator {
  private state: AgentGraphState

  constructor(userGoal: string) {
    this.state = {
      currentRole: 'PLANNER',
      userGoal,
      planMilestones: [],
      completedMilestones: [],
      inspectedFiles: new Map(),
      modifiedFiles: new Set(),
    }
  }

  public get currentState(): AgentGraphState {
    return { ...this.state }
  }

  /**
   * Return specialized system prompts and restricted tool permissions for each role.
   */
  public getRoleConfiguration(role: AgentRole): { systemPrompt: string; allowedTools: string[] } {
    switch (role) {
      case 'PLANNER':
        return {
          systemPrompt: `You are the Lead Systems Architect. Analyze the user goal and create a concise list of verifiable implementation milestones. DO NOT modify code files directly.`,
          allowedTools: ['list_dir', 'list_files_recursive', 'read_file', 'grep_search', 'ask'],
        }
      case 'EXPLORER':
        return {
          systemPrompt: `You are the Repository Explorer. Locate exact functions, classes, and file paths required to fulfill the active plan milestone.`,
          allowedTools: ['read_file', 'extract_code_symbols', 'grep_search', 'list_dir'],
        }
      case 'CODER':
        return {
          systemPrompt: `You are the Code Engineer. Apply targeted, precise code edits matching the active milestone. Ensure valid AST syntax.`,
          allowedTools: ['read_file', 'replace_file_content', 'multi_replace_file_content', 'write_file', 'create_directory'],
        }
      case 'VERIFIER':
        return {
          systemPrompt: `You are the QA Test Critic. Run verification commands (e.g. npm test, tsc) to confirm zero regressions. If errors occur, send the diagnostic trace back to the Coder.`,
          allowedTools: ['run_command', 'finish', 'read_file'],
        }
    }
  }

  /**
   * Transitions state machine between roles upon workflow milestone completion or failure events.
   */
  public transitionState(
    event: 'PLAN_CREATED' | 'EXPLORATION_DONE' | 'CODE_APPLIED' | 'VERIFICATION_PASSED' | 'VERIFICATION_FAILED'
  ): AgentRole {
    switch (this.state.currentRole) {
      case 'PLANNER':
        if (event === 'PLAN_CREATED') this.state.currentRole = 'EXPLORER'
        break
      case 'EXPLORER':
        if (event === 'EXPLORATION_DONE') this.state.currentRole = 'CODER'
        break
      case 'CODER':
        if (event === 'CODE_APPLIED') this.state.currentRole = 'VERIFIER'
        break
      case 'VERIFIER':
        if (event === 'VERIFICATION_PASSED') {
          this.state.currentRole =
            this.state.completedMilestones.length < this.state.planMilestones.length ? 'CODER' : 'VERIFIER'
        } else if (event === 'VERIFICATION_FAILED') {
          this.state.currentRole = 'CODER' // Self-healing fallback loop to Coder
        }
        break
    }
    return this.state.currentRole
  }
}
