import { useCallback, useEffect, useState } from 'react'
import { SkillInstallApprovalRequest, AppSettings, AgentRunIdentity } from '../types'
import { soundEffectsService } from '../services/soundEffectsService'
import { matchesAgentRunIdentity } from '../../shared/domain/agent/agentRunIdentity'

/**
 * Pending hub skill install confirmations raised by the agent loop when the
 * `autoInstallHubSkills` policy is set to 'prompt'. Requests are queued so a second
 * one never silently replaces a request the user has not answered yet.
 */
export function useSkillInstallApproval(settings?: AppSettings, activeRunIdentity?: Readonly<AgentRunIdentity> | null) {
  const [pendingRequests, setPendingRequests] = useState<SkillInstallApprovalRequest[]>([])

  useEffect(() => {
    if (!window.electronAPI?.onAgentSkillInstallRequest) return
    return window.electronAPI.onAgentSkillInstallRequest((req: SkillInstallApprovalRequest) => {
      if (!req?.requestId || !matchesAgentRunIdentity(activeRunIdentity, req)) return
      soundEffectsService.play('interactive', settings?.enableSoundEffects !== false)
      setPendingRequests((prev) => (prev.some((p) => p.requestId === req.requestId) ? prev : [...prev, req]))
    })
  }, [activeRunIdentity, settings?.enableSoundEffects])

  useEffect(() => {
    setPendingRequests((prev) => prev.filter((req) => matchesAgentRunIdentity(activeRunIdentity, req)))
  }, [activeRunIdentity])

  const respond = useCallback((requestId: string, approved: boolean) => {
    const request = pendingRequests.find((candidate) => candidate.requestId === requestId)
    if (request) window.electronAPI?.respondAgentSkillInstall?.(requestId, approved, request)
    setPendingRequests((prev) => prev.filter((req) => req.requestId !== requestId))
  }, [pendingRequests])

  return {
    activeRequest: pendingRequests[0] || null,
    approveInstall: useCallback((requestId: string) => respond(requestId, true), [respond]),
    rejectInstall: useCallback((requestId: string) => respond(requestId, false), [respond]),
  }
}
