import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { sessionHistoryRepository } from './sessionHistoryRepository'
import type { CodingSession } from '../../../../src/types'

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
            agentMode: 'agent',
            outcome: 'success',
            totalSteps: 8,
            filesTouched: 2,
            additions: 30,
            deletions: 4,
          },
        ],
      })
    )

    expect(saved).not.toBeNull()
    // The title is derived from the first executed prompt when the user never renamed it.
    expect(saved?.title).toBe('Aggiungi i test di regressione')
    expect(fs.existsSync(path.join(tempDir, '.onlyrag', 'session_history.json'))).toBe(true)

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

  it('should merge legacy sessions without overwriting the ones already on disk', async () => {
    await sessionHistoryRepository.saveSession(buildSession('session-3', tempDir, { title: 'Su disco' }))

    const merged = await sessionHistoryRepository.mergeSessions(tempDir, [
      buildSession('session-3', tempDir, { title: 'Legacy duplicata' }),
      buildSession('session-4', tempDir, { title: 'Legacy nuova' }),
    ])

    expect(merged).toBe(1)
    const listed = await sessionHistoryRepository.listSessions(tempDir)
    expect(listed).toHaveLength(2)
    expect(listed.find((s) => s.id === 'session-3')?.title).toBe('Su disco')
    expect(listed.find((s) => s.id === 'session-4')?.title).toBe('Legacy nuova')
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
})
