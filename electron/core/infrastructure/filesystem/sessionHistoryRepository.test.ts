import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { SessionHistoryRepository, sessionHistoryRepository } from './sessionHistoryRepository'
import type { CodingSession } from '../../../../shared/types'

function buildSession(id: string, workspacePath: string | null, overrides: Partial<CodingSession> = {}): CodingSession {
  const nowIso = new Date().toISOString()
  return {
    id,
    workspacePath,
    title: 'Nuova Sessione',
    createdAt: nowIso,
    updatedAt: nowIso,
    actionLogs: [],
    executedPrompts: [],
    promptQueue: [],
    ...overrides,
  }
}

describe('SessionHistoryRepository Unit Tests', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-history-test-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('should save, list and delete sessions in the workspace store', async () => {
    const saved = await sessionHistoryRepository.saveSession(
      buildSession('session-1', tempDir, {
        executedPrompts: [
          {
            id: 'p1',
            sessionId: 'session-1',
            prompt: 'Aggiungi i test di regressione',
            startedAt: new Date().toISOString(),
            agentMode: 'auto',
            outcome: 'success',
            totalSteps: 8,
            filesTouched: 2,
            additions: 30,
            deletions: 4,
          },
        ],
      }),
    )

    expect(saved).not.toBeNull()
    // The title is derived from the first executed prompt when the user never renamed it.
    expect(saved?.title).toBe('Aggiungi i test di regressione')
    expect(fs.existsSync(path.join(tempDir, '.onlyrag', 'sessions', 'session_history.json'))).toBe(true)

    const listed = await sessionHistoryRepository.listSessions(tempDir)
    expect(listed).toHaveLength(1)
    expect(listed[0].executedPrompts[0].totalSteps).toBe(8)

    expect(await sessionHistoryRepository.deleteSession('session-1', tempDir)).toBe(true)
    expect(await sessionHistoryRepository.listSessions(tempDir)).toHaveLength(0)
  })

  it('should update an existing session instead of duplicating it', async () => {
    await sessionHistoryRepository.saveSession(buildSession('session-2', tempDir, { title: 'Prima' }))
    await sessionHistoryRepository.saveSession(buildSession('session-2', tempDir, { title: 'Seconda' }))

    const listed = await sessionHistoryRepository.listSessions(tempDir)
    expect(listed).toHaveLength(1)
    expect(listed[0].title).toBe('Seconda')
  })

  it('serializes concurrent conversation saves without dropping either snapshot', async () => {
    await Promise.all([
      sessionHistoryRepository.saveSession(buildSession('session-concurrent-a', tempDir, { title: 'First' })),
      sessionHistoryRepository.saveSession(buildSession('session-concurrent-b', tempDir, { title: 'Second' })),
    ])

    const listed = await sessionHistoryRepository.listSessions(tempDir)
    expect(listed.map((session) => session.id)).toEqual(expect.arrayContaining(['session-concurrent-a', 'session-concurrent-b']))
  })

  it('should clear the whole workspace store', async () => {
    await sessionHistoryRepository.saveSession(buildSession('session-5', tempDir))
    expect(await sessionHistoryRepository.clearSessions(tempDir)).toBe(true)
    expect(await sessionHistoryRepository.listSessions(tempDir)).toHaveLength(0)
  })

  it('should return false, not a false "success", when deleting a session that does not exist anywhere', async () => {
    await sessionHistoryRepository.saveSession(buildSession('session-6', tempDir))
    expect(await sessionHistoryRepository.deleteSession('does-not-exist', tempDir)).toBe(false)
    // The real entry must be untouched by the no-op delete.
    expect(await sessionHistoryRepository.listSessions(tempDir)).toHaveLength(1)
  })

  it('should delete a session saved without a workspacePath even when called with an unrelated one', async () => {
    // Simulates a session created standalone (no active project), which lands in the home
    // fallback store, later deleted while some other workspace happens to be active.
    const standalone = await sessionHistoryRepository.saveSession(buildSession('session-standalone', null))
    expect(standalone).not.toBeNull()

    const unrelatedWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-history-other-'))
    try {
      expect(await sessionHistoryRepository.deleteSession('session-standalone', unrelatedWorkspace)).toBe(true)
      expect((await sessionHistoryRepository.listSessions(null)).find((s) => s.id === 'session-standalone')).toBeUndefined()
    } finally {
      fs.rmSync(unrelatedWorkspace, { recursive: true, force: true })
    }
  })

  it('should clear sessions for a workspace without affecting standalone sessions or other workspaces', async () => {
    const standalone = await sessionHistoryRepository.saveSession(buildSession('session-standalone-keep', null))
    expect(standalone).not.toBeNull()

    const workspaceSession = await sessionHistoryRepository.saveSession(buildSession('session-workspace-clear', tempDir))
    expect(workspaceSession).not.toBeNull()

    expect(await sessionHistoryRepository.clearSessions(tempDir)).toBe(true)
    expect(await sessionHistoryRepository.listSessions(tempDir)).toHaveLength(0)

    const remainingStandalone = await sessionHistoryRepository.listSessions(null)
    expect(remainingStandalone.find((s) => s.id === 'session-standalone-keep')).toBeDefined()

    // Cleanup standalone test session
    await sessionHistoryRepository.deleteSession('session-standalone-keep', null)
  })

  it('migrates legacy standalone sessions into the persistent scratch workspace', async () => {
    const fallbackDir = path.join(tempDir, 'fallback')
    const scratchPath = path.join(tempDir, 'agent-scratch')
    fs.mkdirSync(scratchPath)
    const repository = new SessionHistoryRepository(fallbackDir)
    await repository.saveSession(buildSession('legacy-standalone', null, { title: 'Chat precedente' }))

    expect(await repository.migrateStandaloneSessions(scratchPath)).toBe(1)
    expect(await repository.listSessions(null)).toEqual([])
    expect(await repository.listSessions(scratchPath)).toEqual([
      expect.objectContaining({ id: 'legacy-standalone', workspacePath: scratchPath, title: 'Chat precedente' }),
    ])
    expect(await repository.migrateStandaloneSessions(scratchPath)).toBe(0)
  })
})
