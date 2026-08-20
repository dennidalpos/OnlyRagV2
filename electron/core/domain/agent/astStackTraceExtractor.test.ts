import { describe, it, expect } from 'vitest'
import { extractErrorDiagnostics } from './astStackTraceExtractor'

describe('astStackTraceExtractor', () => {
  it('should extract error location and message from terminal output', () => {
    const output = `npm ERR! Test failed. See logs.
TypeError: Cannot read property 'id' of undefined
    at processTask (d:/GITHUB/OnlyRagV2/src/main.ts:42:15)`

    const frame = extractErrorDiagnostics(output)
    expect(frame).not.toBeNull()
    expect(frame?.filePath).toBe('d:/GITHUB/OnlyRagV2/src/main.ts')
    expect(frame?.lineNumber).toBe(42)
    expect(frame?.errorMessage).toContain("Cannot read property 'id'")
  })
})
