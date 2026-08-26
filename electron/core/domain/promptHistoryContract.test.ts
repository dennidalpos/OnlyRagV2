import { describe, expect, it } from 'vitest'
import { parsePromptHistoryIndexPayload, parsePromptHistorySearchPayload } from './promptHistoryContract'

const validPayload = {
  id: 'prompt-1',
  sessionId: 'session-1',
  workspacePath: 'D:/workspace',
  prompt: 'Add a search button',
  outcome: 'success',
  startedAt: '2026-08-26T21:00:00.000Z',
}

describe('prompt history IPC contract', () => {
  it('accepts the canonical renderer payload', () => {
    expect(parsePromptHistoryIndexPayload(validPayload)).toEqual(validPayload)
  })

  it('rejects incomplete or unsafe-sized payloads before the sidecar call', () => {
    expect(() => parsePromptHistoryIndexPayload({ ...validPayload, prompt: '' })).toThrow()
    expect(() => parsePromptHistoryIndexPayload({ ...validPayload, outcome: 'done' })).toThrow()
    expect(() => parsePromptHistoryIndexPayload({ ...validPayload, prompt: 'x'.repeat(100_001) })).toThrow()
  })

  it('validates search bounds and optional project filters', () => {
    expect(parsePromptHistorySearchPayload('  button  ', 10, ['D:/workspace'])).toEqual({
      query: 'button',
      topK: 10,
      projectPaths: ['D:/workspace'],
    })
    expect(() => parsePromptHistorySearchPayload('button', 0, undefined)).toThrow()
    expect(() => parsePromptHistorySearchPayload('button', 101, undefined)).toThrow()
    expect(() => parsePromptHistorySearchPayload(' ', undefined, undefined)).toThrow()
  })
})
