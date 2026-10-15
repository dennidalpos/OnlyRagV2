import type { CodingSession } from '../../../shared/types'
import type { SessionDeletionOutcome, SessionDeletionRecoveryPage, SessionDeletionRecoverySummary } from '../../../shared/ipc/ipcContract'
import { agentSessionStateRepository } from '../infrastructure/filesystem/agentSessionStateRepository'
import { deleteConversationCheckpoints } from '../infrastructure/filesystem/agentCheckpointStore'
import { sessionDeletionJournal, type SessionDeletionRecoveryRecord } from '../infrastructure/filesystem/sessionDeletionJournal'
import { sessionHistoryRepository } from '../infrastructure/filesystem/sessionHistoryRepository'
import { sessionHistoryRecoveryJournal } from '../infrastructure/filesystem/sessionHistoryRecoveryJournal'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { sidecarAppService } from './sidecarAppService'
import { sessionDeletionRunGate } from './sessionDeletionRunGate'

/** Owns history mutations and retained deletion recovery within one Main process. */
export class SessionHistoryAppService {
  private mutationTail: Promise<void> = Promise.resolve()

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail
    let release: (() => void) | undefined
    this.mutationTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release?.()
    }
  }

  private async pendingFor(sessionIds: readonly string[]): Promise<SessionDeletionRecoveryRecord | undefined> {
    const records = await sessionDeletionJournal.list()
    return records.find((record) => record.status !== 'restored' && record.sessionIds.some((id) => sessionIds.includes(id)))
  }

  private outcome(record: SessionDeletionRecoveryRecord): SessionDeletionOutcome {
    return { status: record.status === 'complete' ? 'complete' : 'pending', operationId: record.operationId, error: record.error }
  }

  private async finishDeletion(record: SessionDeletionRecoveryRecord): Promise<SessionDeletionOutcome> {
    try {
      if (!record.historyDeleted) {
        const current = await sessionHistoryRepository.listCandidateCopies(record.sessionIds, record.workspacePath)
        for (const copy of current) {
          const retained = record.copies.find((item) => item.store === copy.store && item.session.id === copy.session.id)
          if (!retained || JSON.stringify(retained.session) !== JSON.stringify(copy.session)) {
            throw new Error('Changed session history conflicts with deletion')
          }
        }
        for (const sessionId of record.sessionIds) await sessionHistoryRepository.deleteSession(sessionId, record.workspacePath)
        const remaining = await sessionHistoryRepository.listCandidateCopies(record.sessionIds, record.workspacePath)
        if (remaining.length > 0) throw new Error('Retained history copies remain after deletion')
        record.historyDeleted = true
        record = await sessionDeletionJournal.update(record)
      }
      if (!record.indexDeleted) {
        for (let start = 0; start < record.sessionIds.length; start += 100) {
          const ids = record.sessionIds.slice(start, start + 100)
          if (!(await sidecarAppService.removePromptHistoryForSessions(ids, record.operationId)).success) {
            throw new Error('Sidecar did not acknowledge the deletion fence')
          }
        }
        record.indexDeleted = true
        record = await sessionDeletionJournal.update(record)
      }
      for (const sessionId of record.sessionIds) {
        if (!record.stateDeleted.includes(sessionId) || !record.checkpointsDeleted.includes(sessionId)) {
          await sessionDeletionJournal.verifyDeletionAssets(record, sessionId)
        }
        if (!record.stateDeleted.includes(sessionId)) {
          const owner = record.copies.find((copy) => copy.session.id === sessionId)?.session.workspacePath || null
          if (!(await agentSessionStateRepository.clearSessionState(sessionId, owner))) throw new Error('Session state removal was refused')
          record.stateDeleted.push(sessionId)
          record = await sessionDeletionJournal.update(record)
        }
        if (!record.checkpointsDeleted.includes(sessionId)) {
          const owner = record.copies.find((copy) => copy.session.id === sessionId)?.session.workspacePath || null
          if (owner) deleteConversationCheckpoints(owner, sessionId, record.checkpointIds[sessionId] || [])
          record.checkpointsDeleted.push(sessionId)
          record = await sessionDeletionJournal.update(record)
        }
        codingAgentLogger.removeSessionFromAuditLog(sessionId)
      }
      for (const { session } of record.copies) await sessionHistoryRecoveryJournal.removeDeleted(session)
      record.status = 'complete'
      record.error = undefined
      return this.outcome(await sessionDeletionJournal.update(record))
    } catch (error: unknown) {
      record.error = error instanceof Error ? error.message : String(error)
      return this.outcome(await sessionDeletionJournal.update(record))
    }
  }

  async listSessions(workspacePath?: string | null): Promise<CodingSession[]> {
    return sessionHistoryRepository.listSessions(workspacePath)
  }

  async saveSession(session: CodingSession): Promise<CodingSession | null> {
    return this.runExclusive(async () => {
      if (await this.pendingFor([session.id])) return null
      const saved = await sessionHistoryRepository.saveSession(session)
      if (saved) await sessionHistoryRecoveryJournal.acknowledge(saved)
      return saved
    })
  }

  async stageSession(session: CodingSession): Promise<boolean> {
    return this.runExclusive(async () => {
      if (await this.pendingFor([session.id])) return false
      await sessionHistoryRecoveryJournal.stage(session)
      return true
    })
  }

  async listHistoryRecovery(): Promise<Array<{ recoveryId: string; sessionId: string; workspacePath: string | null }>> {
    return this.runExclusive(async () =>
      (await sessionHistoryRecoveryJournal.list()).map(({ recoveryId, session }) => ({
        recoveryId,
        sessionId: session.id,
        workspacePath: session.workspacePath,
      })),
    )
  }

  async retryHistoryRecovery(recoveryId: string): Promise<{ status: 'complete' | 'refused'; error?: string }> {
    return this.runExclusive(async () => {
      const record = await sessionHistoryRecoveryJournal.read(recoveryId)
      if (await this.pendingFor([record.session.id])) return { status: 'refused', error: 'Session deletion owns this history' }
      try {
        const current = (await sessionHistoryRepository.listSessions(record.session.workspacePath)).find((item) => item.id === record.session.id)
        const currentHash = current ? sessionHistoryRecoveryJournal.hashSession(current) : null
        if (currentHash !== record.baseSha256 && currentHash !== record.sessionSha256) {
          return { status: 'refused', error: 'Changed session history conflicts with recovery' }
        }
        if (currentHash !== record.sessionSha256) {
          const saved = await sessionHistoryRepository.saveSession(record.session)
          if (!saved) return { status: 'refused', error: 'Session history write was not acknowledged' }
        }
        await sessionHistoryRecoveryJournal.acknowledge(record.session)
        return { status: 'complete' }
      } catch (error: unknown) {
        return { status: 'refused', error: error instanceof Error ? error.message : String(error) }
      }
    })
  }

  async exportHistoryRecovery(recoveryId: string, destinationDirectory: string): Promise<string> {
    return this.runExclusive(() => sessionHistoryRecoveryJournal.export(recoveryId, destinationDirectory))
  }

  async exportSessionSnapshot(session: CodingSession, destinationDirectory: string): Promise<string> {
    // Export must remain available even when both internal stores are unreadable.
    return this.runExclusive(() => sessionHistoryRecoveryJournal.exportSnapshot(session, destinationDirectory))
  }

  async indexPromptHistory(payload: Parameters<typeof sidecarAppService.indexPromptHistory>[0]): Promise<{ success: boolean }> {
    return this.runExclusive(async () => {
      if (await this.pendingFor([payload.sessionId])) return { success: false }
      return sidecarAppService.indexPromptHistory(payload)
    })
  }

  async deleteSession(sessionId: string, workspacePath?: string | null): Promise<SessionDeletionOutcome> {
    return this.runExclusive(async () => {
      let record: SessionDeletionRecoveryRecord
      if (!sessionDeletionRunGate.reserveDeletion([sessionId])) {
        return { status: 'refused', error: 'Stop the active agent run before deleting its session' }
      }
      let retained = false
      try {
        const existing = await this.pendingFor([sessionId])
        if (existing) {
          retained = true
          return this.outcome(existing)
        }
        const copies = await sessionHistoryRepository.listCandidateCopies([sessionId], workspacePath)
        if (copies.length === 0) return { status: 'refused', error: 'Session has no owned history copy' }
        record = await sessionDeletionJournal.prepare(copies[0].session.workspacePath || null, copies)
        retained = true
      } catch (error: unknown) {
        return { status: 'refused', error: error instanceof Error ? error.message : String(error) }
      } finally {
        if (!retained) sessionDeletionRunGate.releaseDeletion([sessionId])
      }
      try {
        return await this.finishDeletion(record)
      } catch (error: unknown) {
        return { status: 'pending', operationId: record.operationId, error: error instanceof Error ? error.message : String(error) }
      }
    })
  }

  async clearSessions(workspacePath?: string | null): Promise<SessionDeletionOutcome> {
    return this.runExclusive(async () => {
      if (!sessionDeletionRunGate.reserveWorkspaceClear(workspacePath)) {
        return { status: 'refused', error: 'Stop active agent runs before clearing sessions' }
      }
      let record: SessionDeletionRecoveryRecord
      let reservedIds: string[] = []
      let retained = false
      try {
        const pending = (await sessionDeletionJournal.list()).find(
          (record) => (record.status === 'pending' || record.status === 'restoring') && record.workspacePath === (workspacePath || null),
        )
        if (pending) {
          if (!sessionDeletionRunGate.reserveDeletion(pending.sessionIds)) {
            return { status: 'refused', error: 'Stop the active agent run before clearing its session' }
          }
          retained = true
          return this.outcome(pending)
        }
        const copies = await sessionHistoryRepository.listCandidateCopies(null, workspacePath)
        if (copies.length === 0) return { status: 'complete' }
        reservedIds = [...new Set(copies.map((copy) => copy.session.id))]
        if (!sessionDeletionRunGate.reserveDeletion(reservedIds)) {
          return { status: 'refused', error: 'Stop the active agent run before clearing its session' }
        }
        const existing = await this.pendingFor(copies.map((copy) => copy.session.id))
        if (existing) {
          retained = true
          return this.outcome(existing)
        }
        record = await sessionDeletionJournal.prepare(workspacePath || null, copies)
        retained = true
      } catch (error: unknown) {
        return { status: 'refused', error: error instanceof Error ? error.message : String(error) }
      } finally {
        if (!retained) sessionDeletionRunGate.releaseDeletion(reservedIds)
        sessionDeletionRunGate.releaseWorkspaceClear(workspacePath)
      }
      try {
        return await this.finishDeletion(record)
      } catch (error: unknown) {
        return { status: 'pending', operationId: record.operationId, error: error instanceof Error ? error.message : String(error) }
      }
    })
  }

  async listDeletionRecovery(offset = 0): Promise<SessionDeletionRecoveryPage> {
    if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) throw new Error('Invalid recovery page offset')
    const summaries: SessionDeletionRecoverySummary[] = (await sessionDeletionJournal.list())
      .filter((record) => record.status !== 'restored')
      .map(({ operationId, workspacePath, sessionIds, status, error }) => ({
        operationId,
        workspacePath,
        sessionIds,
        status: status as 'pending' | 'restoring' | 'complete',
        error,
      }))
    for (const preparation of await sessionDeletionJournal.listIncompletePreparations()) {
      summaries.push({ operationId: preparation.operationId, workspacePath: null, sessionIds: [], status: 'incomplete', error: preparation.error })
    }
    return { operations: summaries.slice(offset, offset + 50), total: summaries.length }
  }

  async retryDeletion(operationId: string): Promise<SessionDeletionOutcome> {
    return this.runExclusive(async () => {
      const record = await sessionDeletionJournal.read(operationId)
      if (record.status !== 'pending') return { status: 'refused', operationId, error: 'Recovery operation cannot be retried as deletion' }
      if (!sessionDeletionRunGate.reserveDeletion(record.sessionIds)) {
        return { status: 'refused', operationId, error: 'Stop the active agent run before retrying deletion' }
      }
      return this.finishDeletion(record)
    })
  }

  async restoreDeletion(operationId: string): Promise<SessionDeletionOutcome> {
    return this.runExclusive(async () => {
      let record = await sessionDeletionJournal.read(operationId)
      if (record.status === 'restored') return { status: 'refused', operationId, error: 'Recovery operation is already restored' }
      if (!sessionDeletionRunGate.reserveDeletion(record.sessionIds)) {
        return { status: 'refused', operationId, error: 'Stop the active agent run before restoring deletion' }
      }
      try {
        if (record.status !== 'restoring') {
          record.status = 'restoring'
          record = await sessionDeletionJournal.update(record)
        }
        await sessionDeletionJournal.verifyRestoreAssets(record)
        await sessionHistoryRepository.verifyCandidateRestore(record.copies, record.workspacePath)
        await sessionDeletionJournal.restoreAssets(record)
        await sessionHistoryRepository.restoreCandidateCopies(record.copies, record.workspacePath)
        for (let start = 0; start < record.sessionIds.length; start += 100) {
          const ids = record.sessionIds.slice(start, start + 100)
          let restored = await sidecarAppService.restorePromptHistoryForSessions(ids, operationId)
          if (!restored.success) {
            if (!(await sidecarAppService.removePromptHistoryForSessions(ids, operationId)).success) throw new Error('Sidecar restore fence was refused')
            restored = await sidecarAppService.restorePromptHistoryForSessions(ids, operationId)
            if (!restored.success) throw new Error('Sidecar restore was not acknowledged')
          }
        }
        const prompts = new Map<string, { prompt: (typeof record.copies)[number]['session']['executedPrompts'][number]; workspacePath: string | null }>()
        for (const { session } of record.copies) {
          for (const prompt of session.executedPrompts) {
            if (!prompts.has(prompt.id)) prompts.set(prompt.id, { prompt, workspacePath: session.workspacePath })
          }
        }
        for (const { prompt, workspacePath } of prompts.values()) {
          if (!workspacePath || !prompt.prompt.trim()) continue
          if (
            !(
              await sidecarAppService.indexPromptHistory({
                id: prompt.id,
                sessionId: prompt.sessionId,
                workspacePath,
                prompt: prompt.prompt,
                summary: prompt.summary,
                outcome: prompt.outcome,
                startedAt: prompt.startedAt,
                completedAt: prompt.completedAt,
              })
            ).success
          )
            throw new Error('Prompt history reindex was not acknowledged')
        }
        record.status = 'restored'
        record.error = undefined
        await sessionDeletionJournal.update(record)
        sessionDeletionRunGate.releaseDeletion(record.sessionIds)
        return { status: 'complete', operationId }
      } catch (error: unknown) {
        record.error = error instanceof Error ? error.message : String(error)
        record = await sessionDeletionJournal.update(record)
        return this.outcome(record)
      }
    })
  }

  async exportDeletion(operationId: string, destinationDirectory: string): Promise<string> {
    return this.runExclusive(async () => {
      const incomplete = await sessionDeletionJournal.listIncompletePreparations()
      if (incomplete.some((item) => item.operationId === operationId)) {
        return sessionDeletionJournal.exportIncompletePreparation(operationId, destinationDirectory)
      }
      return sessionDeletionJournal.exportBundle(operationId, destinationDirectory)
    })
  }
}

export const sessionHistoryAppService = new SessionHistoryAppService()
