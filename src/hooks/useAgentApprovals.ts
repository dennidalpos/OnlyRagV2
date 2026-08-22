import { useState, useCallback } from 'react'
import { logger } from '../lib/logger'

export interface PendingApprovalRequest {
  sessionId: string
  type: 'write_file' | 'replace_chunk' | 'multi_replace' | 'delete_file' | 'download_file' | 'terminal_cmd' | 'git_commit'
  target: string
  contentOrCmd: string
  replacement?: string
  replacements?: { targetContent: string; replacementContent: string }[]
  parameters?: Record<string, any>
}

export function useAgentApprovals() {
  const [pendingApproval, setPendingApproval] = useState<PendingApprovalRequest | null>(null)

  const handleApprove = useCallback(
    async (approved: boolean, approvedHunks?: any) => {
      if (!pendingApproval || !window.electronAPI?.respondToAgentApproval) return
      const current = pendingApproval
      setPendingApproval(null)
      try {
        await window.electronAPI.respondToAgentApproval(current.sessionId, approved, approvedHunks)
      } catch (err: any) {
        logger.error('useAgentApprovals', `Failed responding to agent approval: ${err?.message}`)
      }
    },
    [pendingApproval]
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
