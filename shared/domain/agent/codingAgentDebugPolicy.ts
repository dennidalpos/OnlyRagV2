import type { AppSettings } from '../../types'

export function isCodingAgentDebugPayloadCaptureEnabled(settings: Pick<AppSettings, 'enableCodingAgentDebugLog'> | undefined): boolean {
  return settings?.enableCodingAgentDebugLog === true
}
