import type { AgentChatMessage, AgentChatToolCall, AgentChatTurn } from '../infrastructure/http/agentStreamTransport'
import { countPromptTokens } from '../../../shared/domain/agent/contextWindowCalculator'

/** A request rebuilds its current context but retains the actual assistant/tool exchange. */
export function boundedChatMessages(
  corePrompt: string,
  optionalSections: readonly string[],
  userTask: string,
  history: AgentChatMessage[],
  maxPromptTokens: number,
  forceCompact = false,
): { messages: AgentChatMessage[]; retainedHistory: AgentChatMessage[] } {
  let lastAssistant = -1
  for (let index = history.length - 1; index >= 0; index--) {
    if (history[index].role === 'assistant') {
      lastAssistant = index
      break
    }
  }
  const retainedHistory = forceCompact && lastAssistant >= 0 ? history.slice(lastAssistant) : [...history]
  const base: AgentChatMessage[] = [
    { role: 'system', content: corePrompt },
    { role: 'user', content: userTask },
  ]
  while (retainedHistory.length > 0 && countPromptTokens(JSON.stringify([...base, ...retainedHistory])) > maxPromptTokens) {
    if (retainedHistory.filter((message) => message.role === 'assistant').length <= 1) break
    retainedHistory.shift()
    while (retainedHistory[0]?.role === 'tool') retainedHistory.shift()
  }
  for (const section of optionalSections) {
    if (!section.trim()) continue
    const candidate = [...base, ...retainedHistory]
    candidate[0] = { ...candidate[0], content: `${candidate[0].content}\n\n${section}` }
    if (countPromptTokens(JSON.stringify(candidate)) <= maxPromptTokens) base[0] = candidate[0]
  }
  return { messages: [...base, ...retainedHistory], retainedHistory }
}

export function appendAssistantTurn(history: AgentChatMessage[], turn: AgentChatTurn): AgentChatMessage[] {
  return [
    ...history,
    {
      role: 'assistant',
      content: turn.content,
      ...(turn.thinking ? { thinking: turn.thinking } : {}),
      ...(turn.toolCalls.length > 0 ? { tool_calls: turn.toolCalls } : {}),
    },
  ]
}

export function appendToolResponse(history: AgentChatMessage[], call: AgentChatToolCall, output: string): AgentChatMessage[] {
  return [...history, { role: 'tool', tool_name: call.function.name, content: output.slice(0, 8000) }]
}

/** A resumed run must not send an assistant batch with missing tool responses. */
export function completeInterruptedBatch(history: AgentChatMessage[]): AgentChatMessage[] {
  const messages = [...history]
  let assistantIndex = -1
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === 'assistant') {
      assistantIndex = index
      break
    }
  }
  if (assistantIndex < 0) return messages
  const calls = messages[assistantIndex].tool_calls || []
  const answered = messages.slice(assistantIndex + 1).filter((message) => message.role === 'tool').length
  for (const call of calls.slice(answered)) {
    messages.push({ role: 'tool', tool_name: call.function.name, content: 'Not executed: the previous run ended before this call.' })
  }
  return messages
}
