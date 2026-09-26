import { describe, expect, it } from 'vitest'
import {
  appendAssistantTurn,
  appendToolResponse,
  boundToolOutput,
  buildChatRequest,
  completeInterruptedBatch,
  composeSessionSystemPrompt,
} from './agentChatTranscript'

const firstCall = { type: 'function' as const, function: { index: 0, name: 'read_file', arguments: { filePath: 'a.ts' } } }
const secondCall = { type: 'function' as const, function: { index: 1, name: 'read_file', arguments: { filePath: 'b.ts' } } }

describe('native Ollama transcript', () => {
  it('keeps assistant thinking and every result in the next request', () => {
    let history = appendAssistantTurn([], { content: 'Reading', thinking: 'Need both files', toolCalls: [firstCall, secondCall] })
    history = appendToolResponse(history, firstCall, 'a.ts content')
    history = appendToolResponse(history, secondCall, 'b.ts content')
    const next = buildChatRequest({ systemPrompt: 'System rules', userTask: 'Inspect both files', history, turnContext: 'Step 2/50', maxPromptTokens: 2048 })
    expect(next.messages).toEqual([
      { role: 'system', content: 'System rules' },
      { role: 'user', content: 'Inspect both files' },
      expect.objectContaining({ role: 'assistant', thinking: 'Need both files', tool_calls: [firstCall, secondCall] }),
      { role: 'tool', tool_name: 'read_file', content: 'a.ts content' },
      { role: 'tool', tool_name: 'read_file', content: 'b.ts content' },
      { role: 'user', content: 'Step 2/50' },
    ])
    expect(next.retainedHistory).toEqual([...history, { role: 'user', content: 'Step 2/50' }])
  })

  it('drops old batches but retains the latest complete batch and current task when context is tight', () => {
    const history = [
      { role: 'assistant' as const, content: 'old'.repeat(2000) },
      { role: 'tool' as const, tool_name: 'read_file', content: 'old result'.repeat(2000) },
      { role: 'assistant' as const, content: 'latest', tool_calls: [firstCall] },
      { role: 'tool' as const, tool_name: 'read_file', content: 'current result' },
    ]
    const next = buildChatRequest({ systemPrompt: 'Rules', userTask: 'Fix the task', history, turnContext: 'Plan', maxPromptTokens: 400 })
    expect(next.messages[0].content).toBe('Rules')
    expect(next.messages[1].content).toBe('Fix the task')
    expect(next.retainedHistory).toEqual([...history.slice(2), { role: 'user', content: 'Plan' }])
    expect(next.messages.at(-1)).toEqual({ role: 'user', content: 'Plan' })
  })

  it('makes every request an exact extension of the previous one, so even recurrent-layer models reuse their cache', () => {
    const systemPrompt = composeSessionSystemPrompt('Rules', ['Pinned file', 'Repo map'.repeat(5000)], 200)
    expect(systemPrompt).toBe('Rules\n\nPinned file')
    let history = appendAssistantTurn([], { content: '', thinking: '', toolCalls: [firstCall] })
    history = appendToolResponse(history, firstCall, 'a.ts content')
    const turn2 = buildChatRequest({ systemPrompt, userTask: 'Task', history, turnContext: 'Step 2/50 | plan m-1 in_progress', maxPromptTokens: 4096 })
    history = appendAssistantTurn(turn2.retainedHistory, { content: '', thinking: '', toolCalls: [secondCall] })
    history = appendToolResponse(history, secondCall, 'b.ts content')
    const turn3 = buildChatRequest({ systemPrompt, userTask: 'Task', history, turnContext: 'Step 3/50 | plan m-1 verified', maxPromptTokens: 4096 })
    expect(turn3.messages.slice(0, turn2.messages.length)).toEqual(turn2.messages)
    expect(turn3.messages.at(-1)).toEqual({ role: 'user', content: 'Step 3/50 | plan m-1 verified' })
  })

  it('trims old batches to 70% of the budget in one step, not one batch per turn', () => {
    const batch = (n: number) => [
      { role: 'assistant' as const, content: `call ${n}` },
      { role: 'tool' as const, tool_name: 'read_file', content: `file ${n}: ${'alpha beta gamma delta '.repeat(40)}` },
    ]
    const history = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].flatMap(batch)
    const next = buildChatRequest({ systemPrompt: 'Rules', userTask: 'Task', history, turnContext: '', maxPromptTokens: 1000 })
    const kept = next.retainedHistory.filter((message) => message.role === 'assistant').length
    expect(kept).toBeGreaterThan(0)
    expect(kept).toBeLessThan(10)
    const again = buildChatRequest({
      systemPrompt: 'Rules',
      userTask: 'Task',
      history: [...next.retainedHistory, ...batch(11)],
      turnContext: '',
      maxPromptTokens: 1000,
    })
    expect(again.retainedHistory.slice(0, next.retainedHistory.length)).toEqual(next.retainedHistory)
  })

  it('keeps head and tail of an oversized tool result and says what was cut', () => {
    const output = `${'h'.repeat(6000)}${'m'.repeat(6000)}ERROR at the end`
    const bounded = boundToolOutput(output)
    expect(bounded.length).toBeLessThanOrEqual(8000)
    expect(bounded).toMatch(/^h+/)
    expect(bounded).toContain('[TRUNCATED: ')
    expect(bounded.endsWith('ERROR at the end')).toBe(true)
    expect(boundToolOutput('short')).toBe('short')
  })

  it('marks unexecuted calls after an interrupted run instead of replaying them as completed', () => {
    const history = appendToolResponse(appendAssistantTurn([], { content: '', thinking: '', toolCalls: [firstCall, secondCall] }), firstCall, 'done')
    expect(completeInterruptedBatch(history)).toEqual([
      ...history,
      { role: 'tool', tool_name: 'read_file', content: 'Not executed: the previous run ended before this call.' },
    ])
  })
})
