import { describe, expect, it } from 'vitest'
import { isCodingAgentDebugPayloadCaptureEnabled } from '../../../../shared/domain/agent/codingAgentDebugPolicy'

describe('codingAgentDebugPolicy', () => {
  it('requires both the parent log and the saved sensitive-payload opt-in', () => {
    expect(isCodingAgentDebugPayloadCaptureEnabled(undefined)).toBe(false)
    expect(isCodingAgentDebugPayloadCaptureEnabled({ enableCodingAgentDebugLog: false, includeCodingAgentDebugPayloads: true })).toBe(false)
    expect(isCodingAgentDebugPayloadCaptureEnabled({ enableCodingAgentDebugLog: true, includeCodingAgentDebugPayloads: false })).toBe(false)
    expect(isCodingAgentDebugPayloadCaptureEnabled({ enableCodingAgentDebugLog: true, includeCodingAgentDebugPayloads: true })).toBe(true)
  })
})
