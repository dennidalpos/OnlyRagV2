import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionHistoryCopy } from '../infrastructure/filesystem/sessionHistoryRepository'
import type { SessionDeletionRecoveryRecord } from '../infrastructure/filesystem/sessionDeletionJournal'

const state = vi.hoisted(() => ({ records: new Map<string, unknown>(), deleted: false, sequence: 0 }))

vi.mock('../infrastructure/filesystem/sessionHistoryRepository', () => ({
  sessionHistoryRepository: {
    listSessions: vi.fn(),
    listCandidateCopies: vi.fn(),
    deleteSession: vi.fn(),
    restoreCandidateCopies: vi.fn(),
    verifyCandidateRestore: vi.fn(),
    saveSession: vi.fn(),
  },
}))
vi.mock('../infrastructure/filesystem/sessionDeletionJournal', () => ({
  sessionDeletionJournal: {
    list: vi.fn(async () => [...state.records.values()]),
    read: vi.fn(async (id: string) => {
      const record = state.records.get(id)
      if (!record) throw new Error('Missing recovery record')
      return record
    }),
    prepare: vi.fn(async (workspacePath: string | null, copies: SessionHistoryCopy[]) => {
      const record: SessionDeletionRecoveryRecord = {
        version: 1,
        operationId: `operation-${++state.sequence}`,
        workspacePath,
        sessionIds: [...new Set(copies.map((copy) => copy.session.id))],
        copies,
        copiesSha256: '',
        recordSha256: '',
        checkpointIds: Object.fromEntries(
          copies.map(({ session }) => [
            session.id,
            session.executedPrompts?.map((prompt) => prompt.evidence?.checkpointId).filter((id): id is string => Boolean(id)) || [],
          ]),
        ),
        assets: [],
        historyDeleted: false,
        indexDeleted: false,
        stateDeleted: [],
        checkpointsDeleted: [],
        status: 'pending',
      }
      state.records.set(record.operationId, record)
      return record
    }),
    update: vi.fn(async (record: SessionDeletionRecoveryRecord) => {
      state.records.set(record.operationId, record)
      return record
    }),
    restoreAssets: vi.fn(),
    verifyRestoreAssets: vi.fn(),
    verifyDeletionAssets: vi.fn(),
    exportBundle: vi.fn(async () => 'C:/synthetic/export'),
  },
}))
vi.mock('../infrastructure/filesystem/agentSessionStateRepository', () => ({
  agentSessionStateRepository: { clearSessionState: vi.fn() },
}))
vi.mock('../infrastructure/filesystem/agentCheckpointStore', () => ({
  deleteConversationCheckpoints: vi.fn(),
}))
vi.mock('../infrastructure/logging/codingAgentLogger', () => ({
  codingAgentLogger: { removeSessionFromAuditLog: vi.fn() },
}))
vi.mock('./sidecarAppService', () => ({
  sidecarAppService: {
    removePromptHistoryForSessions: vi.fn(),
    restorePromptHistoryForSessions: vi.fn(),
    indexPromptHistory: vi.fn(),
  },
}))
vi.mock('./sessionDeletionRunGate', () => ({
  sessionDeletionRunGate: {
    reserveDeletion: vi.fn(() => true),
    releaseDeletion: vi.fn(),
    reserveWorkspaceClear: vi.fn(() => true),
    releaseWorkspaceClear: vi.fn(),
  },
}))

import { SessionHistoryAppService } from './sessionHistoryAppService'
import { sessionHistoryRepository } from '../infrastructure/filesystem/sessionHistoryRepository'
import { sessionDeletionJournal } from '../infrastructure/filesystem/sessionDeletionJournal'
import { agentSessionStateRepository } from '../infrastructure/filesystem/agentSessionStateRepository'
import { deleteConversationCheckpoints } from '../infrastructure/filesystem/agentCheckpointStore'
import { sidecarAppService } from './sidecarAppService'

const copy = (id: string, checkpointId = 'checkpoint-1'): SessionHistoryCopy => ({
  store: 'workspace',
  session: {
    id,
    workspacePath: 'C:/synthetic',
    title: id,
    createdAt: '2026-10-12T00:00:00Z',
    updatedAt: '2026-10-12T00:00:00Z',
    actionLogs: [],
    executedPrompts: [
      {
        id: `prompt-${id}`,
        sessionId: id,
        prompt: 'Test prompt',
        startedAt: '2026-10-12T00:00:00Z',
        agentMode: 'guided',
        outcome: 'success',
        totalSteps: 1,
        filesTouched: 0,
        additions: 0,
        deletions: 0,
        evidence: { checkpointId } as never,
      },
    ],
  },
})

describe('session deletion recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.records.clear()
    state.deleted = false
    state.sequence = 0
    vi.mocked(sessionHistoryRepository.listCandidateCopies).mockImplementation(async () => (state.deleted ? [] : [copy('session')]))
    vi.mocked(sessionHistoryRepository.deleteSession).mockImplementation(async () => {
      state.deleted = true
      return true
    })
    vi.mocked(sessionHistoryRepository.restoreCandidateCopies).mockResolvedValue()
    vi.mocked(agentSessionStateRepository.clearSessionState).mockResolvedValue(true)
    vi.mocked(sidecarAppService.removePromptHistoryForSessions).mockResolvedValue({ success: true })
    vi.mocked(sidecarAppService.restorePromptHistoryForSessions).mockResolvedValue({ success: true })
    vi.mocked(sidecarAppService.indexPromptHistory).mockResolvedValue({ success: true })
  })

  it('prepares and acknowledges every owned deletion phase', async () => {
    const service = new SessionHistoryAppService()
    expect(await service.deleteSession('session', 'C:/synthetic')).toMatchObject({ status: 'complete', operationId: 'operation-1' })
    expect(sessionDeletionJournal.prepare).toHaveBeenCalledBefore(vi.mocked(sessionHistoryRepository.deleteSession))
    expect(sidecarAppService.removePromptHistoryForSessions).toHaveBeenCalledWith(['session'], 'operation-1')
    expect(agentSessionStateRepository.clearSessionState).toHaveBeenCalledWith('session', 'C:/synthetic')
    expect(deleteConversationCheckpoints).toHaveBeenCalledWith('C:/synthetic', 'session', ['checkpoint-1'])
  })

  it('retains an incomplete operation and blocks a stale save or index', async () => {
    const service = new SessionHistoryAppService()
    vi.mocked(sidecarAppService.removePromptHistoryForSessions).mockResolvedValueOnce({ success: false })
    expect(await service.deleteSession('session', 'C:/synthetic')).toMatchObject({ status: 'pending', operationId: 'operation-1' })
    expect(await service.saveSession(copy('session').session)).toBeNull()
    expect(
      await service.indexPromptHistory({
        id: 'prompt-session',
        sessionId: 'session',
        workspacePath: 'C:/synthetic',
        prompt: 'Test',
        outcome: 'success',
        startedAt: '2026-10-12T00:00:00Z',
      }),
    ).toEqual({ success: false })
    expect((await service.listDeletionRecovery()).operations).toMatchObject([{ operationId: 'operation-1', status: 'pending' }])
    expect(await service.retryDeletion('operation-1')).toMatchObject({ status: 'complete' })
    expect(sidecarAppService.removePromptHistoryForSessions).toHaveBeenLastCalledWith(['session'], 'operation-1')
  })

  it('restores retained history and assets, then explicitly reindexes prompts', async () => {
    const service = new SessionHistoryAppService()
    vi.mocked(agentSessionStateRepository.clearSessionState).mockResolvedValueOnce(false)
    expect(await service.deleteSession('session', 'C:/synthetic')).toMatchObject({ status: 'pending' })
    expect(await service.restoreDeletion('operation-1')).toMatchObject({ status: 'complete' })
    expect(sessionDeletionJournal.restoreAssets).toHaveBeenCalled()
    expect(sessionHistoryRepository.restoreCandidateCopies).toHaveBeenCalled()
    expect(sidecarAppService.restorePromptHistoryForSessions).toHaveBeenCalledWith(['session'], 'operation-1')
    expect(sidecarAppService.indexPromptHistory).toHaveBeenCalledWith(expect.objectContaining({ id: 'prompt-session' }))
  })

  it('refuses preparation without an owned history copy', async () => {
    const service = new SessionHistoryAppService()
    state.deleted = true
    expect(await service.deleteSession('missing', 'C:/synthetic')).toMatchObject({ status: 'refused' })
    expect(sessionDeletionJournal.prepare).not.toHaveBeenCalled()
  })

  it('uses the retained owner when deleting a standalone session from a project view', async () => {
    const service = new SessionHistoryAppService()
    vi.mocked(sessionHistoryRepository.listCandidateCopies).mockImplementation(async () =>
      state.deleted
        ? []
        : [
            {
              ...copy('session'),
              session: { ...copy('session').session, workspacePath: null },
            },
          ],
    )
    expect(await service.deleteSession('session', 'C:/synthetic')).toMatchObject({ status: 'complete' })
    expect(sessionDeletionJournal.prepare).toHaveBeenCalledWith(null, expect.any(Array))
    expect(agentSessionStateRepository.clearSessionState).toHaveBeenCalledWith('session', null)
    expect(deleteConversationCheckpoints).not.toHaveBeenCalled()
  })

  it('reports a refused recovery preparation before touching history or Sidecar', async () => {
    const service = new SessionHistoryAppService()
    vi.mocked(sessionDeletionJournal.prepare).mockRejectedValueOnce(new Error('Recovery disk unavailable'))
    expect(await service.deleteSession('session', 'C:/synthetic')).toEqual({ status: 'refused', error: 'Recovery disk unavailable' })
    expect(sessionHistoryRepository.deleteSession).not.toHaveBeenCalled()
    expect(sidecarAppService.removePromptHistoryForSessions).not.toHaveBeenCalled()
  })

  it('keeps state and checkpoints when history removal is refused, then retries', async () => {
    const service = new SessionHistoryAppService()
    vi.mocked(sessionHistoryRepository.deleteSession).mockRejectedValueOnce(new Error('History write refused'))
    expect(await service.deleteSession('session', 'C:/synthetic')).toMatchObject({ status: 'pending', error: 'History write refused' })
    expect(sidecarAppService.removePromptHistoryForSessions).not.toHaveBeenCalled()
    expect(agentSessionStateRepository.clearSessionState).not.toHaveBeenCalled()
    expect(await service.retryDeletion('operation-1')).toMatchObject({ status: 'complete' })
  })

  it('retains the checkpoint phase after a cleanup error and retries only that phase', async () => {
    const service = new SessionHistoryAppService()
    vi.mocked(deleteConversationCheckpoints).mockImplementationOnce(() => {
      throw new Error('Checkpoint locked')
    })
    expect(await service.deleteSession('session', 'C:/synthetic')).toMatchObject({ status: 'pending', error: 'Checkpoint locked' })
    expect(agentSessionStateRepository.clearSessionState).toHaveBeenCalledTimes(1)
    expect(await service.retryDeletion('operation-1')).toMatchObject({ status: 'complete' })
    expect(agentSessionStateRepository.clearSessionState).toHaveBeenCalledTimes(1)
    expect(deleteConversationCheckpoints).toHaveBeenCalledTimes(2)
  })
})
