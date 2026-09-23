import { describe, expect, it } from 'vitest'
import type { RendererEventSink } from '../domain/ports/rendererEventSink'
import { SkillInstallApprovalService } from './skillInstallApprovalService'

const identity = { runId: 'run:1', conversationId: 'c-1', planRevisionId: 'p-1', workspaceId: 'workspace:C:/w' }
const candidate = { skillName: 'lint', skillDescription: 'Lint helper', hubName: 'curated', score: 9 }

function fakeWindow(sent: Array<{ requestId: string }>): RendererEventSink {
  return {
    isAvailable: () => true,
    send: (_channel, payload) => sent.push(payload as { requestId: string }),
  }
}

describe('SkillInstallApprovalService', () => {
  it('resolves the pending request with the answer that carries its run identity', async () => {
    const service = new SkillInstallApprovalService()
    const sent: Array<{ requestId: string }> = []
    const approval = service.requestApproval(fakeWindow(sent), candidate, identity)

    // An answer from another run must be ignored, or the request would settle as denied here.
    service.handleResponse({ ...identity, runId: 'run:other', requestId: sent[0].requestId, approved: false })
    service.handleResponse({ ...identity, requestId: sent[0].requestId, approved: true })

    await expect(approval).resolves.toBe(true)
  })

  it('denies without asking when there is no window to ask in', async () => {
    await expect(new SkillInstallApprovalService().requestApproval(null, candidate, identity)).resolves.toBe(false)
  })
})
