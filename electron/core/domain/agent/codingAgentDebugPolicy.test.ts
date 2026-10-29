import { describe, expect, it } from 'vitest'
import { isCodingAgentDebugPayloadCaptureEnabled } from '../../../../shared/domain/agent/codingAgentDebugPolicy'

describe('codingAgentDebugPolicy', () => {
  it('uses only the debug logging switch', () => {
    expect(isCodingAgentDebugPayloadCaptureEnabled(undefined)).toBe(false)
    expect(isCodingAgentDebugPayloadCaptureEnabled({ enableCodingAgentDebugLog: false })).toBe(false)
    expect(isCodingAgentDebugPayloadCaptureEnabled({ enableCodingAgentDebugLog: true })).toBe(true)
  })
})
