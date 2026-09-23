import { BrowserWindow } from 'electron'
import { logger } from '../../diagnostics'
import type { AgentRunIdentity } from '../../../shared/types'
import { matchesAgentRunIdentity } from '../../../shared/domain/agent/agentRunIdentity'

export const SKILL_INSTALL_REQUEST_CHANNEL = 'agent:skill-install-request'

/** Auto-install candidate submitted to the user when autoInstallHubSkills is 'prompt'. */
export interface SkillInstallCandidate {
  skillName: string
  skillDescription: string
  hubName: string
  score: number
}

/** How long a pending request waits for the user before resolving as denied. */
const APPROVAL_TIMEOUT_MS = 120_000

/** Request/response bridge for the hub skill auto-install confirmation. */
export class SkillInstallApprovalService {
  private readonly pendingRequests = new Map<string, {
    identity: Readonly<AgentRunIdentity>
    resolve: (approved: boolean) => void
  }>()
  /** Settles a pending request; the renderer's answer arrives via the presentation layer (agentIpc). */
  public handleResponse(payload: Partial<AgentRunIdentity> & { requestId?: string; approved?: boolean }): void {
    const pending = payload?.requestId ? this.pendingRequests.get(payload.requestId) : undefined
    if (!pending || !payload?.requestId || !matchesAgentRunIdentity(pending.identity, payload)) return
    this.pendingRequests.delete(payload.requestId)
    pending.resolve(payload.approved === true)
  }

  public async requestApproval(
    targetWindow: BrowserWindow | null,
    candidate: SkillInstallCandidate,
    identity: Readonly<AgentRunIdentity>
  ): Promise<boolean> {
    if (!targetWindow || targetWindow.isDestroyed()) return false

    const requestId = `skill-install-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    return new Promise<boolean>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        logger.log('WARN', 'SkillInstallApproval', `No answer for '${candidate.skillName}' within ${APPROVAL_TIMEOUT_MS / 1000}s: install denied.`)
        resolve(false)
      }, APPROVAL_TIMEOUT_MS)

      this.pendingRequests.set(requestId, {
        identity,
        resolve: (approved: boolean) => {
          clearTimeout(timeoutHandle)
          logger.log('INFO', 'SkillInstallApproval', `User ${approved ? 'approved' : 'denied'} the install of hub skill '${candidate.skillName}'.`)
          resolve(approved)
        },
      })

      targetWindow.webContents.send(SKILL_INSTALL_REQUEST_CHANNEL, { ...identity, requestId, ...candidate })
    })
  }
}

export const skillInstallApprovalService = new SkillInstallApprovalService()
