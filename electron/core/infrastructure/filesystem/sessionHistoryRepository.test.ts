import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { SessionHistoryRepository, sessionHistoryRepository } from './sessionHistoryRepository'
import type { CodingSession } from '../../../../shared/types'
import * as atomicWriter from './safeAtomicFileWriter'

function buildSession(id: string, workspacePath: string | null, overrides: Partial<CodingSession> = {}): CodingSession {
  const nowIso = new Date().toISOString()
  return {
    id,
    workspacePath,
    title: '',
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
    vi.restoreAllMocks()
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it.each(['{broken', '{"version":99,"sessions":[]}', '{"version":1}', '{"version":1,"sessions":[{"id":"kept"},null]}'])(
    'preserves unreadable or unsupported history: %s',
    async (raw) => {
      const repo = new SessionHistoryRepository(tempDir)
      const file = path.join(tempDir, 'session_history.json')
      fs.writeFileSync(file, raw)
      await expect(repo.listSessions(null)).rejects.toThrow()
      await expect(repo.saveSession(buildSession('new', null))).rejects.toThrow()
      await expect(repo.clearSessions(null)).rejects.toThrow()
      expect(fs.readFileSync(file, 'utf8')).toBe(raw)
    },
  )

  it('refuses to silently discard malformed nested records during normalization', async () => {
    const repo = new SessionHistoryRepository(tempDir)
    const raw = JSON.stringify({ version: 1, sessions: [buildSession('kept', null, { plans: [{ id: 'unknown-plan' } as never] })] })
    const file = path.join(tempDir, 'session_history.json')
    fs.writeFileSync(file, raw)
    await expect(repo.saveSession(buildSession('new', null))).rejects.toThrow()
    expect(fs.readFileSync(file, 'utf8')).toBe(raw)
  })

  it('preserves inaccessible history and allows retry after the read failure resolves', async () => {
    const repo = new SessionHistoryRepository(tempDir)
    await repo.saveSession(buildSession('retained', null))
    const file = path.join(tempDir, 'session_history.json')
    const raw = fs.readFileSync(file, 'utf8')
    vi.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(Object.assign(new Error('Access denied'), { code: 'EACCES' }))
    await expect(repo.saveSession(buildSession('new', null))).rejects.toThrow()
    expect(fs.readFileSync(file, 'utf8')).toBe(raw)
    await repo.saveSession(buildSession('new', null))
    expect((await repo.listSessions(null)).map((item) => item.id)).toEqual(expect.arrayContaining(['retained', 'new']))
  })

  it('still reads versionless legacy sessions without rewriting on load', async () => {
    const repo = new SessionHistoryRepository(tempDir)
    const raw = JSON.stringify({ sessions: [{ id: 'legacy', actionLogs: [], title: 'Kept' }] })
    const file = path.join(tempDir, 'session_history.json')
    fs.writeFileSync(file, raw)
    expect(await repo.listSessions(null)).toEqual([expect.objectContaining({ id: 'legacy', title: 'Kept' })])
    expect(fs.readFileSync(file, 'utf8')).toBe(raw)
  })

  it.each(['delete', 'clear'])('validates all candidate stores before %s mutates any of them', async (operation) => {
    const fallback = path.join(tempDir, 'fallback')
    const repo = new SessionHistoryRepository(fallback)
    await repo.saveSession(buildSession('retained', tempDir))
    const workspaceFile = path.join(tempDir, '.onlyrag', 'sessions', 'history.json')
    const raw = fs.readFileSync(workspaceFile, 'utf8')
    fs.mkdirSync(fallback)
    fs.writeFileSync(path.join(fallback, 'session_history.json'), '{broken')
    await expect(operation === 'delete' ? repo.deleteSession('retained', tempDir) : repo.clearSessions(tempDir)).rejects.toThrow()
    expect(fs.readFileSync(workspaceFile, 'utf8')).toBe(raw)
  })

  it('rejects duplicate retained identities before upsert collapses them', async () => {
    const repo = new SessionHistoryRepository(tempDir)
    const file = path.join(tempDir, 'session_history.json')
    const raw = JSON.stringify({ version: 1, sessions: [buildSession('duplicate', null), buildSession('duplicate', null)] })
    fs.writeFileSync(file, raw)
    await expect(repo.saveSession(buildSession('duplicate', null))).rejects.toThrow()
    expect(fs.readFileSync(file, 'utf8')).toBe(raw)
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
    expect(fs.existsSync(path.join(tempDir, '.onlyrag', 'sessions', 'history.json'))).toBe(true)

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

  it.each(['delete', 'clear'] as const)('refuses %s success when a candidate-store write fails, then retries remaining stores', async (operation) => {
    const fallback = path.join(tempDir, 'fallback')
    const repo = new SessionHistoryRepository(fallback)
    const kept = buildSession('retained', tempDir)
    await repo.saveSession(kept)
    fs.mkdirSync(fallback)
    const fallbackFile = path.join(fallback, 'session_history.json')
    fs.writeFileSync(fallbackFile, JSON.stringify({ version: 1, sessions: [kept, buildSession('unrelated', null)] }))
    const original = atomicWriter.safeAtomicWrite
    const write = vi.spyOn(atomicWriter, 'safeAtomicWrite')
    write.mockImplementation(async (file, content) => (file === fallbackFile ? false : original(file, content)))
    const result = operation === 'delete' ? repo.deleteSession('retained', tempDir) : repo.clearSessions(tempDir)
    if (operation === 'delete') await expect(result).rejects.toThrow('Session deletion was not acknowledged')
    else expect(await result).toBe(false)
    expect(JSON.parse(fs.readFileSync(fallbackFile, 'utf8')).sessions.map((item: CodingSession) => item.id)).toEqual(['retained', 'unrelated'])
    write.mockRestore()
    expect(await (operation === 'delete' ? repo.deleteSession('retained', tempDir) : repo.clearSessions(tempDir))).toBe(true)
    expect(JSON.parse(fs.readFileSync(fallbackFile, 'utf8')).sessions.map((item: CodingSession) => item.id)).toEqual(['unrelated'])
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
