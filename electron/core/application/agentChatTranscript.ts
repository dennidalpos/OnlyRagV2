import type { AgentChatMessage, AgentChatToolCall, AgentChatTurn } from '../infrastructure/http/agentStreamTransport'
import { countPromptTokens } from '../../../shared/domain/agent/contextWindowCalculator'

/**
 * The system message for a whole session. Ollama reuses its KV cache only for the longest common
 * token prefix of consecutive requests, so everything that changes per turn (step counter, plan
 * state, directives, errors) lives in the trailing turn message instead. Optional context sections
 * (pinned files, active file, RAG, repository map) are added in priority order while they fit
 * `maxTokens`, then frozen with the rest.
 */
export function composeSessionSystemPrompt(corePrompt: string, optionalSections: readonly string[], maxTokens: number): string {
  let prompt = corePrompt
  for (const section of optionalSections) {
    if (!section.trim()) continue
    const candidate = `${prompt}\n\n${section}`
    if (countPromptTokens(candidate) <= maxTokens) prompt = candidate
  }
  return prompt
}

/** Share of the prompt budget history is trimmed back to, so trimming happens rarely and in one step. */
const HISTORY_TRIM_TARGET = 0.7

function dropOldestBatch(history: AgentChatMessage[]): void {
  history.shift()
  while (history[0] && history[0].role !== 'assistant') history.shift()
}

/**
 * One native request: `[system, task, ...history, turn context]`, append-only. The turn context joins
 * the history, so every request extends the previous one exactly. Transformer KV caches reuse any
 * common prefix, but hybrid models with recurrent layers (qwen3.5/3.8's Gated DeltaNet) can only
 * resume from the exact end of the previous request: dropping the previous turn context made
 * qwen3.8:27b re-evaluate the whole prompt every turn. When history outgrows the budget the oldest
 * batches go, down to 70% of it, so the cache is invalidated once per trim. The latest batch stays.
 */
export function buildChatRequest(input: {
  systemPrompt: string
  userTask: string
  history: AgentChatMessage[]
  turnContext: string
  maxPromptTokens: number
  forceCompact?: boolean
}): { messages: AgentChatMessage[]; retainedHistory: AgentChatMessage[]; trimmed: boolean } {
  const { systemPrompt, userTask, history, turnContext, maxPromptTokens, forceCompact = false } = input
  let lastAssistant = -1
  for (let index = history.length - 1; index >= 0; index--) {
    if (history[index].role === 'assistant') {
      lastAssistant = index
      break
    }
  }
  const retainedHistory = forceCompact && lastAssistant >= 0 ? history.slice(lastAssistant) : [...history]
  const base: AgentChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userTask },
  ]
  const tail: AgentChatMessage[] = turnContext.trim() ? [{ role: 'user', content: turnContext }] : []
  const tokens = () => countPromptTokens(JSON.stringify([...base, ...retainedHistory, ...tail]))
  const assistantCount = () => retainedHistory.filter((message) => message.role === 'assistant').length
  if (tokens() > maxPromptTokens) {
    const target = Math.floor(maxPromptTokens * HISTORY_TRIM_TARGET)
    while (assistantCount() > 1 && tokens() > target) dropOldestBatch(retainedHistory)
  }
  return {
    messages: [...base, ...retainedHistory, ...tail],
    retainedHistory: [...retainedHistory, ...tail],
    trimmed: retainedHistory.length < history.length,
  }
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

/** Largest tool result the native transcript carries uncut (see boundToolOutput). */
export const TOOL_RESULT_MAX_CHARS = 8000
const TOOL_RESULT_TAIL_CHARS = 2500

/**
 * Bounds one tool result for the transcript. Errors usually sit at the end of command output, so the
 * tail is kept alongside the head, and the cut is stated instead of silent.
 */
export function boundToolOutput(output: string): string {
  if (output.length <= TOOL_RESULT_MAX_CHARS) return output
  // 120 characters are reserved for the marker itself.
  const headLength = TOOL_RESULT_MAX_CHARS - TOOL_RESULT_TAIL_CHARS - 120
  const omitted = output.length - headLength - TOOL_RESULT_TAIL_CHARS
  const marker = `\n[TRUNCATED: ${omitted} of ${output.length} characters omitted from the middle]\n`
  return `${output.slice(0, headLength)}${marker}${output.slice(-TOOL_RESULT_TAIL_CHARS)}`
}

export function appendToolResponse(history: AgentChatMessage[], call: AgentChatToolCall, output: string): AgentChatMessage[] {
  return [...history, { role: 'tool', tool_name: call.function.name, content: boundToolOutput(output) }]
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
