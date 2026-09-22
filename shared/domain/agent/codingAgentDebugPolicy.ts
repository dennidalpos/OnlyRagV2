import type { AppSettings } from '../../types'

/** A saved payload preference has no effect while audit logging is disabled. */
export function isCodingAgentDebugPayloadCaptureEnabled(
  settings: Pick<AppSettings, 'enableCodingAgentDebugLog' | 'includeCodingAgentDebugPayloads'> | undefined,
): boolean {
  return settings?.enableCodingAgentDebugLog === true && settings.includeCodingAgentDebugPayloads === true
}
