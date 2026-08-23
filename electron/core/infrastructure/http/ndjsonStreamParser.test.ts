import { describe, it, expect } from 'vitest'
import { consumeNdjsonChunk } from './ndjsonStreamParser'

describe('NDJSON Stream Parser Unit Tests', () => {
  it('should parse complete single-line and multi-line chunks', () => {
    const parsed: any[] = []
    let buffer = ''

    buffer = consumeNdjsonChunk(buffer, '{"response": "Hello"}\n{"response": " World"}\n', (obj) => {
      parsed.push(obj)
    })

    expect(buffer).toBe('')
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toEqual({ response: 'Hello' })
    expect(parsed[1]).toEqual({ response: ' World' })
  })

  it('should handle partial split chunks cleanly across calls', () => {
    const parsed: any[] = []
    let buffer = ''

    // Chunk 1: half of first object
    buffer = consumeNdjsonChunk(buffer, '{"response": "Hel', (obj) => {
      parsed.push(obj)
    })
    expect(buffer).toBe('{"response": "Hel')
    expect(parsed).toHaveLength(0)

    // Chunk 2: completion of first object + start of second
    buffer = consumeNdjsonChunk(buffer, 'lo"}\n{"done":', (obj) => {
      parsed.push(obj)
    })
    expect(buffer).toBe('{"done":')
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toEqual({ response: 'Hello' })

    // Chunk 3: end of second
    buffer = consumeNdjsonChunk(buffer, ' true}\n', (obj) => {
      parsed.push(obj)
    })
    expect(buffer).toBe('')
    expect(parsed).toHaveLength(2)
    expect(parsed[1]).toEqual({ done: true })
  })

  it('should skip malformed chunks and invoke warning callback without throwing', () => {
    const parsed: any[] = []
    const warnings: string[] = []
    let buffer = ''

    buffer = consumeNdjsonChunk(
      buffer,
      '{"valid": true}\nINVALID_JSON_HERE\n{"valid_again": 123}\n',
      (obj) => parsed.push(obj),
      (_err, line) => warnings.push(line)
    )

    expect(buffer).toBe('')
    expect(parsed).toHaveLength(2)
    expect(warnings).toEqual(['INVALID_JSON_HERE'])
  })
})
