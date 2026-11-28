import { useState, useCallback } from 'react'
import { logger } from '../lib/logger'
import type { AgentApprovalRequest } from '../types'
import { errorMessage } from '../../shared/domain/errors/errorMessage'

export type PendingApprovalRequest = AgentApprovalRequest

export function useAgentApprovals() {
  const [pendingApproval, setPendingApproval] = useState<PendingApprovalRequest | null>(null)

  const handleApprove = useCallback(
    async (approved: boolean, approvedHunks?: number[]) => {
      if (!pendingApproval || !window.electronAPI?.respondToAgentApproval) return
      const current = pendingApproval
      setPendingApproval(null)
      try {
        await window.electronAPI.respondToAgentApproval({ identity: current, approved, approvedHunkIndices: approvedHunks })
      } catch (err: unknown) {
        logger.error('useAgentApprovals', `Failed responding to agent approval: ${errorMessage(err)}`)
      }
    },
    [pendingApproval],
  )

  const handleReject = useCallback(() => {
    if (!pendingApproval) return
    handleApprove(false)
  }, [pendingApproval, handleApprove])

  const clearPendingApproval = useCallback(() => {
    setPendingApproval(null)
  }, [])

  return {
    pendingApproval,
    setPendingApproval,
    clearPendingApproval,
    handleApprove,
    handleReject,
  }
}
