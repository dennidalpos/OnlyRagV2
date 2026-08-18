import { BrowserWindow, ipcMain } from 'electron'
import { logger } from '../../diagnostics'

export const SKILL_INSTALL_REQUEST_CHANNEL = 'agent:skill-install-request'
export const SKILL_INSTALL_RESPONSE_CHANNEL = 'agent:skill-install-response'

/** Auto-install candidate submitted to the user when autoInstallHubSkills is 'prompt'. */
export interface SkillInstallCandidate {
  skillName: string
  skillDescription: string
  hubName: string
  score: number
}

/** How long a pending request waits for the user before resolving as denied. */
const APPROVAL_TIMEOUT_MS = 120_000

/**
 * Request/response bridge for the hub skill auto-install confirmation. The decision is
 * needed while the main process assembles the turn prompt, so the renderer's answer is
 * awaited here instead of being fired and forgotten like the tool approval events.
 * A request nobody answers resolves as denied, so the agent loop can never deadlock.
 */
export class SkillInstallApprovalService {
  private readonly pendingRequests = new Map<string, (approved: boolean) => void>()
  private isListenerRegistered = false

  private ensureResponseListener(): void {
    if (this.isListenerRegistered) return
    ipcMain.on(SKILL_INSTALL_RESPONSE_CHANNEL, (_event, payload: { requestId?: string; approved?: boolean }) => {
      const resolver = payload?.requestId ? this.pendingRequests.get(payload.requestId) : undefined
      if (!resolver || !payload?.requestId) return
      this.pendingRequests.delete(payload.requestId)
      resolver(payload.approved === true)
    })
    this.isListenerRegistered = true
  }

  public async requestApproval(
    targetWindow: BrowserWindow | null,
    candidate: SkillInstallCandidate
  ): Promise<boolean> {
    if (!targetWindow || targetWindow.isDestroyed()) return false
    this.ensureResponseListener()

    const requestId = `skill-install-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    return new Promise<boolean>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        logger.log('WARN', 'SkillInstallApproval', `No answer for '${candidate.skillName}' within ${APPROVAL_TIMEOUT_MS / 1000}s: install denied.`)
        resolve(false)
      }, APPROVAL_TIMEOUT_MS)

      this.pendingRequests.set(requestId, (approved: boolean) => {
        clearTimeout(timeoutHandle)
        logger.log('INFO', 'SkillInstallApproval', `User ${approved ? 'approved' : 'denied'} the install of hub skill '${candidate.skillName}'.`)
        resolve(approved)
      })

      targetWindow.webContents.send(SKILL_INSTALL_REQUEST_CHANNEL, { requestId, ...candidate })
    })
  }
}

export const skillInstallApprovalService = new SkillInstallApprovalService()
