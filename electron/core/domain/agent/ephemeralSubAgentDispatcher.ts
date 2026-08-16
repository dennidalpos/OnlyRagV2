export interface SubAgentTaskRequest {
  role: 'RESEARCHER' | 'TEST_DISCOVERER' | 'INSPECTOR'
  taskDescription: string
  contextSnippet: string
  maxTokenBudget: number
}

export interface SubAgentTaskResponse {
  success: boolean
  summary: string
  discoveredFacts: string[]
  tokensUsed: number
}

/**
 * Spawns ephemeral, short-lived worker agent sub-contexts with restricted token caps
 * to perform heavy discovery without contaminating the parent orchestrator's context window.
 */
export class EphemeralSubAgentDispatcher {
  /**
   * Constructs an isolated prompt context for the worker sub-agent.
   */
  public static buildSubAgentPrompt(request: SubAgentTaskRequest): string {
    return `[SUB-AGENT WORKER ROLE: ${request.role}]
Task: ${request.taskDescription}
Token Cap: ${request.maxTokenBudget} tokens.

[CONTEXT SNIPPET]
${request.contextSnippet}

INSTRUCTIONS:
1. Perform the assigned discovery task concisely.
2. Return ONLY a structured summary with key findings and file references.
3. DO NOT output conversational preamble.`
  }

  /**
   * Formats the sub-agent response for integration into parent context.
   */
  public static formatSubAgentReport(response: SubAgentTaskResponse): string {
    const status = response.success ? 'SUCCESS' : 'FAILED'
    const facts = response.discoveredFacts.map((f) => `- ${f}`).join('\n')

    return `[SUB-AGENT REPORT: ${status}]
Summary: ${response.summary}
Key Discoveries:
${facts || 'None'}
[END SUB-AGENT REPORT]`
  }
}
