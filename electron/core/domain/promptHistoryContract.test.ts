import { describe, expect, it } from 'vitest'
import { promptHistoryIndexPayloadSchema, promptHistorySearchPayloadSchema } from './promptHistoryContract'

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
    expect(promptHistoryIndexPayloadSchema.parse(validPayload)).toEqual(validPayload)
  })

  it('rejects incomplete or unsafe-sized payloads before the sidecar call', () => {
    expect(() => promptHistoryIndexPayloadSchema.parse({ ...validPayload, prompt: '' })).toThrow()
    expect(() => promptHistoryIndexPayloadSchema.parse({ ...validPayload, outcome: 'done' })).toThrow()
    expect(() => promptHistoryIndexPayloadSchema.parse({ ...validPayload, prompt: 'x'.repeat(100_001) })).toThrow()
  })

  it('validates search bounds and optional project filters', () => {
    expect(promptHistorySearchPayloadSchema.parse({ query: '  button  ', topK: 10, projectPaths: ['D:/workspace'] })).toEqual({
      query: 'button',
      topK: 10,
      projectPaths: ['D:/workspace'],
    })
    expect(() => promptHistorySearchPayloadSchema.parse({ query: 'button', topK: 0 })).toThrow()
    expect(() => promptHistorySearchPayloadSchema.parse({ query: 'button', topK: 101 })).toThrow()
    expect(() => promptHistorySearchPayloadSchema.parse({ query: ' ' })).toThrow()
  })
})
