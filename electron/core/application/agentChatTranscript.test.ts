import { describe, expect, it } from 'vitest'
import { appendAssistantTurn, appendToolResponse, boundedChatMessages, completeInterruptedBatch } from './agentChatTranscript'

const firstCall = { type: 'function' as const, function: { index: 0, name: 'read_file', arguments: { filePath: 'a.ts' } } }
const secondCall = { type: 'function' as const, function: { index: 1, name: 'read_file', arguments: { filePath: 'b.ts' } } }

describe('native Ollama transcript', () => {
  it('keeps assistant thinking and every result in the next request', () => {
    let history = appendAssistantTurn([], { content: 'Reading', thinking: 'Need both files', toolCalls: [firstCall, secondCall] })
    history = appendToolResponse(history, firstCall, 'a.ts content')
    history = appendToolResponse(history, secondCall, 'b.ts content')
    const next = boundedChatMessages('System rules', [], 'Inspect both files', history, 2048)
    expect(next.messages).toEqual([
      { role: 'system', content: 'System rules' },
      { role: 'user', content: 'Inspect both files' },
      expect.objectContaining({ role: 'assistant', thinking: 'Need both files', tool_calls: [firstCall, secondCall] }),
      { role: 'tool', tool_name: 'read_file', content: 'a.ts content' },
      { role: 'tool', tool_name: 'read_file', content: 'b.ts content' },
    ])
  })

  it('drops old batches but retains the latest complete batch and current task when context is tight', () => {
    const history = [
      { role: 'assistant' as const, content: 'old'.repeat(2000) },
      { role: 'tool' as const, tool_name: 'read_file', content: 'old result'.repeat(2000) },
      { role: 'assistant' as const, content: 'latest', tool_calls: [firstCall] },
      { role: 'tool' as const, tool_name: 'read_file', content: 'current result' },
    ]
    const next = boundedChatMessages('Rules and current plan', ['Optional repo map'.repeat(2000)], 'Fix the task', history, 400)
    expect(next.messages[0].content).toBe('Rules and current plan')
    expect(next.messages[1].content).toBe('Fix the task')
    expect(next.retainedHistory).toEqual(history.slice(2))
  })

  it('marks unexecuted calls after an interrupted run instead of replaying them as completed', () => {
    const history = appendToolResponse(appendAssistantTurn([], { content: '', thinking: '', toolCalls: [firstCall, secondCall] }), firstCall, 'done')
    expect(completeInterruptedBatch(history)).toEqual([
      ...history,
      { role: 'tool', tool_name: 'read_file', content: 'Not executed: the previous run ended before this call.' },
    ])
  })
})
