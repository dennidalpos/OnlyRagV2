import type { AgentToolCall } from '../domain/agent/agentTypes'
import type { ToolExecutionResult } from '../domain/agent/tools/toolExecutionContracts'

/** Application service for agent diagnostics and clarification requests. */
export class DiagnosticsToolService {
  executeAsk(parameters: AgentToolCall['parameters'], explanation?: string): ToolExecutionResult {
    const question = parameters.question || parameters.query || explanation || 'Clarification requested from user.'
    return {
      outputForHistory: `Agent requested clarification: "${question}"`,
      logMessage: `Agent Question: ${question}`,
      logDetail: question,
    }
  }
}
