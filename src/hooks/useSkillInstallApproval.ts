import { useCallback, useEffect, useState } from 'react'
import { SkillInstallApprovalRequest } from '../types'

/**
 * Pending hub skill install confirmations raised by the agent loop when the
 * `autoInstallHubSkills` policy is set to 'prompt'. Requests are queued so a second
 * one never silently replaces a request the user has not answered yet.
 */
export function useSkillInstallApproval() {
  const [pendingRequests, setPendingRequests] = useState<SkillInstallApprovalRequest[]>([])

  useEffect(() => {
    if (!window.electronAPI?.onAgentSkillInstallRequest) return
    return window.electronAPI.onAgentSkillInstallRequest((req: SkillInstallApprovalRequest) => {
      if (!req?.requestId) return
      setPendingRequests((prev) => (prev.some((p) => p.requestId === req.requestId) ? prev : [...prev, req]))
    })
  }, [])

  const respond = useCallback((requestId: string, approved: boolean) => {
    window.electronAPI?.respondAgentSkillInstall?.(requestId, approved)
    setPendingRequests((prev) => prev.filter((req) => req.requestId !== requestId))
  }, [])

  return {
    activeRequest: pendingRequests[0] || null,
    approveInstall: useCallback((requestId: string) => respond(requestId, true), [respond]),
    rejectInstall: useCallback((requestId: string) => respond(requestId, false), [respond]),
  }
}
