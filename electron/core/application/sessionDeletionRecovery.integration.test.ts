import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CodingSession } from '../../../shared/types'

vi.mock('../infrastructure/filesystem/userDataRoot', () => ({
  userDataSessionsDir: () => path.join(process.env.ONLYRAG_TEST_RECOVERY_ROOT || '', 'sessions'),
  userDataRoot: () => process.env.ONLYRAG_TEST_RECOVERY_ROOT || '',
}))

let root: string | undefined
afterEach(() => {
  vi.restoreAllMocks()
  if (root) fs.rmSync(root, { recursive: true, force: true })
  root = undefined
  delete process.env.ONLYRAG_TEST_RECOVERY_ROOT
})

it('refuses deletion while an agent run owns the conversation and fences a later run', async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-session-run-gate-'))
  process.env.ONLYRAG_TEST_RECOVERY_ROOT = root
  vi.resetModules()
  const { SessionHistoryAppService } = await import('./sessionHistoryAppService')
  const { sessionDeletionRunGate } = await import('./sessionDeletionRunGate')
  const { sidecarAppService } = await import('./sidecarAppService')
  const service = new SessionHistoryAppService()
  const session: CodingSession = {
    id: 'active-conversation',
    workspacePath: null,
    title: 'Active',
    createdAt: '2026-10-12T00:00:00Z',
    updatedAt: '2026-10-12T00:00:00Z',
    actionLogs: [],
    executedPrompts: [],
  }
  expect(await service.saveSession(session)).not.toBeNull()
  const endRun = sessionDeletionRunGate.beginRun(session.id)
  expect(endRun).not.toBeNull()
  expect(await service.deleteSession(session.id, null)).toMatchObject({ status: 'refused', error: 'Stop the active agent run before deleting its session' })
  expect((await service.listSessions(null)).some((item) => item.id === session.id)).toBe(true)
  endRun?.()
  vi.spyOn(sidecarAppService, 'removePromptHistoryForSessions').mockResolvedValue({ success: false })
  expect(await service.deleteSession(session.id, null)).toMatchObject({ status: 'pending' })
  expect(sessionDeletionRunGate.beginRun(session.id)).toBeNull()
})

it('refuses clear while an unstored agent run owns the workspace', async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-session-clear-gate-'))
  process.env.ONLYRAG_TEST_RECOVERY_ROOT = root
  vi.resetModules()
  const { SessionHistoryAppService } = await import('./sessionHistoryAppService')
  const { sessionDeletionRunGate } = await import('./sessionDeletionRunGate')
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace)
  const endRun = sessionDeletionRunGate.beginRun('not-yet-stored', workspace)
  expect(endRun).not.toBeNull()
  const service = new SessionHistoryAppService()
  expect(await service.clearSessions(workspace)).toMatchObject({ status: 'refused', error: 'Stop active agent runs before clearing sessions' })
  endRun?.()
  expect(await service.clearSessions(workspace)).toMatchObject({ status: 'complete' })
})

it('retains both stores and owned assets through a refused fence, then retries after a fresh Main module load', async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-session-recovery-'))
  process.env.ONLYRAG_TEST_RECOVERY_ROOT = root
  vi.resetModules()
  const { SessionHistoryAppService } = await import('./sessionHistoryAppService')
  const { sidecarAppService } = await import('./sidecarAppService')
  const { workspaceMetadataSessionDirectory, workspaceMetadataChildPath } = await import('../infrastructure/filesystem/workspaceMetadataDirectory')
  const { sessionHistoryRepository } = await import('../infrastructure/filesystem/sessionHistoryRepository')
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace)
  const session: CodingSession = {
    id: 'owned-session',
    workspacePath: workspace,
    title: 'Retained',
    createdAt: '2026-10-12T00:00:00Z',
    updatedAt: '2026-10-12T00:00:00Z',
    actionLogs: [],
    executedPrompts: [
      {
        id: 'prompt-1',
        sessionId: 'owned-session',
        prompt: 'Retain this',
        startedAt: '2026-10-12T00:00:00Z',
        agentMode: 'guided',
        outcome: 'success',
        totalSteps: 1,
        filesTouched: 0,
        additions: 0,
        deletions: 0,
        evidence: { checkpointId: 'checkpoint-1' } as never,
      },
    ],
  }
  const service = new SessionHistoryAppService()
  expect(await service.saveSession(session)).not.toBeNull()
  const fallback = path.join(root, 'sessions')
  fs.mkdirSync(fallback, { recursive: true })
  fs.writeFileSync(path.join(fallback, 'session_history.json'), JSON.stringify({ version: 1, sessions: [{ ...session, title: 'Fallback copy' }] }))
  const stateDir = workspaceMetadataSessionDirectory(workspace, session.id)
  fs.mkdirSync(stateDir, { recursive: true })
  fs.writeFileSync(path.join(stateDir, 'state.json'), JSON.stringify({ sessionId: session.id, workspacePath: workspace, marker: 'owned state' }))
  const checkpoint = path.join(workspaceMetadataChildPath(workspace, 'checkpoints'), 'checkpoint-1')
  fs.mkdirSync(checkpoint, { recursive: true })
  fs.writeFileSync(path.join(checkpoint, 'manifest.json'), JSON.stringify({ version: 2, checkpointId: 'checkpoint-1', conversationId: session.id, files: [] }))
  fs.writeFileSync(path.join(checkpoint, '0.bin'), Buffer.from([5, 4, 3]))

  vi.spyOn(sidecarAppService, 'removePromptHistoryForSessions').mockResolvedValueOnce({ success: false })
  const first = await service.deleteSession(session.id, workspace)
  expect(first).toMatchObject({ status: 'pending' })
  expect(await sessionHistoryRepository.listCandidateCopies([session.id], workspace)).toEqual([])
  expect(JSON.parse(fs.readFileSync(path.join(stateDir, 'state.json'), 'utf-8')).marker).toBe('owned state')
  expect(await service.saveSession(session)).toBeNull()

  vi.resetModules()
  const { SessionHistoryAppService: FreshService } = await import('./sessionHistoryAppService')
  const { sidecarAppService: freshSidecar } = await import('./sidecarAppService')
  vi.spyOn(freshSidecar, 'removePromptHistoryForSessions').mockResolvedValue({ success: true })
  const restarted = new FreshService()
  expect((await restarted.listDeletionRecovery()).operations).toMatchObject([{ operationId: first.operationId, status: 'pending' }])
  expect(await restarted.retryDeletion(first.operationId!)).toMatchObject({ status: 'complete' })
  expect(fs.existsSync(stateDir)).toBe(false)
  expect(fs.existsSync(checkpoint)).toBe(false)
  expect((await restarted.listDeletionRecovery()).operations).toMatchObject([{ operationId: first.operationId, status: 'complete' }])
  const { sessionDeletionJournal } = await import('../infrastructure/filesystem/sessionDeletionJournal')
  const retained = await sessionDeletionJournal.read(first.operationId!)
  expect(retained.copies.map((copy) => copy.session.title)).toEqual(['Retained', 'Fallback copy'])
  expect(retained.assets.map((asset) => asset.kind)).toEqual(['session-state', 'checkpoint'])
})

it('restores exact retained assets and history after an interrupted synthetic cleanup, then exports the bundle', async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-session-restore-'))
  process.env.ONLYRAG_TEST_RECOVERY_ROOT = root
  vi.resetModules()
  const { sessionDeletionJournal } = await import('../infrastructure/filesystem/sessionDeletionJournal')
  const { sessionHistoryRepository } = await import('../infrastructure/filesystem/sessionHistoryRepository')
  const { workspaceMetadataSessionDirectory, workspaceMetadataChildPath } = await import('../infrastructure/filesystem/workspaceMetadataDirectory')
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace)
  const session: CodingSession = {
    id: 'restore-owned',
    workspacePath: workspace,
    title: 'Original',
    createdAt: '2026-10-12T00:00:00Z',
    updatedAt: '2026-10-12T00:00:00Z',
    actionLogs: [],
    executedPrompts: [
      {
        id: 'restore-prompt',
        sessionId: 'restore-owned',
        prompt: 'Restore',
        startedAt: '2026-10-12T00:00:00Z',
        agentMode: 'guided',
        outcome: 'success',
        totalSteps: 1,
        filesTouched: 0,
        additions: 0,
        deletions: 0,
        evidence: { checkpointId: 'restore-checkpoint' } as never,
      },
    ],
  }
  await sessionHistoryRepository.saveSession(session)
  const stateDir = workspaceMetadataSessionDirectory(workspace, session.id)
  fs.mkdirSync(stateDir, { recursive: true })
  const originalState = JSON.stringify({ sessionId: session.id, workspacePath: workspace, marker: 'original' })
  fs.writeFileSync(path.join(stateDir, 'state.json'), originalState)
  const checkpoint = path.join(workspaceMetadataChildPath(workspace, 'checkpoints'), 'restore-checkpoint')
  fs.mkdirSync(checkpoint, { recursive: true })
  fs.writeFileSync(
    path.join(checkpoint, 'manifest.json'),
    JSON.stringify({ version: 2, checkpointId: 'restore-checkpoint', conversationId: session.id, files: [] }),
  )
  fs.writeFileSync(path.join(checkpoint, '0.bin'), Buffer.from([9, 8, 7]))
  const copies = await sessionHistoryRepository.listCandidateCopies([session.id], workspace)
  const record = await sessionDeletionJournal.prepare(workspace, copies)
  await sessionHistoryRepository.deleteSession(session.id, workspace)
  fs.rmSync(stateDir, { recursive: true })
  fs.rmSync(checkpoint, { recursive: true })
  vi.resetModules()
  const { SessionHistoryAppService } = await import('./sessionHistoryAppService')
  const { sidecarAppService } = await import('./sidecarAppService')
  const { sessionDeletionJournal: restartedJournal } = await import('../infrastructure/filesystem/sessionDeletionJournal')
  const { sessionHistoryRepository: restartedHistory } = await import('../infrastructure/filesystem/sessionHistoryRepository')
  vi.spyOn(sidecarAppService, 'restorePromptHistoryForSessions').mockResolvedValueOnce({ success: false }).mockResolvedValue({ success: true })
  vi.spyOn(sidecarAppService, 'removePromptHistoryForSessions').mockResolvedValue({ success: true })
  vi.spyOn(sidecarAppService, 'indexPromptHistory').mockResolvedValue({ success: true })
  const service = new SessionHistoryAppService()
  expect((await service.listDeletionRecovery()).operations).toMatchObject([{ operationId: record.operationId, status: 'pending' }])
  expect(await service.restoreDeletion(record.operationId)).toMatchObject({ status: 'complete' })
  expect(fs.readFileSync(path.join(stateDir, 'state.json'), 'utf-8')).toBe(originalState)
  expect(fs.readFileSync(path.join(checkpoint, '0.bin'))).toEqual(Buffer.from([9, 8, 7]))
  expect((await restartedHistory.listCandidateCopies([session.id], workspace))[0].session.title).toBe('Original')
  expect((await restartedJournal.read(record.operationId)).status).toBe('restored')
  const exportDirectory = path.join(root, 'export')
  fs.mkdirSync(exportDirectory)
  const exported = await service.exportDeletion(record.operationId, exportDirectory)
  expect(fs.readFileSync(path.join(exported, 'assets', '0', 'state.json'), 'utf-8')).toBe(originalState)
  expect(fs.existsSync(path.join(root, 'sessions', 'deletion-recovery', record.operationId, 'record.json'))).toBe(true)
})
