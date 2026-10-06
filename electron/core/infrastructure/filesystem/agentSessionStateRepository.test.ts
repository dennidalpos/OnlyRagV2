import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { SessionDebtTracker } from '../../domain/agent/sessionDebtTracker'
import { AgentSessionStateRepository, agentSessionStateRepository, SavedAgentSessionState } from './agentSessionStateRepository'
import { workspaceMetadataStatePath, workspaceMetadataTrackerPath } from './workspaceMetadataDirectory'

describe('AgentSessionStateRepository Unit Tests', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-session-test-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it.each(['{broken', '{}', 'null', '[]', '{"version":99}'])('preserves invalid state %s during load, seed and save', async (original) => {
    const sessionId = 'invalid-state'
    const filePath = workspaceMetadataStatePath(tempDir, sessionId)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, original)
    await expect(agentSessionStateRepository.loadSessionState(sessionId, tempDir)).rejects.toThrow('original data is preserved')
    await expect(agentSessionStateRepository.seedPlanMilestones(sessionId, tempDir, [])).rejects.toThrow('original data is preserved')
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(original)
    const replacement = {
      sessionId,
      workspacePath: tempDir,
      agentMode: 'guided' as const,
      stepCount: 0,
      maxSteps: 0,
      episodes: [],
      recentFullLogs: [],
      planMilestones: [],
      userTask: 'New task',
      updatedAt: new Date().toISOString(),
    }
    await expect(agentSessionStateRepository.saveSessionState(replacement)).resolves.toBe(false)
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(original)
    fs.writeFileSync(filePath, JSON.stringify(replacement))
    await expect(agentSessionStateRepository.seedPlanMilestones(sessionId, tempDir, [{ id: 'retry', title: 'Retry', status: 'pending' }])).resolves.toBe(true)
  })

  it('does not turn a blocked state read into absence and permits retry', async () => {
    await agentSessionStateRepository.seedPlanMilestones('blocked-read', tempDir, [])
    const filePath = workspaceMetadataStatePath(tempDir, 'blocked-read')
    const original = fs.readFileSync(filePath)
    const readFile = fs.promises.readFile.bind(fs.promises)
    const blocked = vi.spyOn(fs.promises, 'readFile').mockImplementation((...args: Parameters<typeof fs.promises.readFile>) => {
      if (args[0] === filePath) return Promise.reject(Object.assign(new Error('Access denied'), { code: 'EACCES' }))
      return readFile(...args)
    })
    await expect(agentSessionStateRepository.loadSessionState('blocked-read', tempDir)).rejects.toThrow('original data is preserved')
    await expect(agentSessionStateRepository.seedPlanMilestones('blocked-read', tempDir, [])).rejects.toThrow('original data is preserved')
    expect(fs.readFileSync(filePath)).toEqual(original)
    blocked.mockRestore()
    await expect(agentSessionStateRepository.seedPlanMilestones('blocked-read', tempDir, [])).resolves.toBe(true)
  })

  it('rejects mismatched identities and invalid nested execution records without rewriting them', async () => {
    await agentSessionStateRepository.seedPlanMilestones('retained', tempDir, [])
    const filePath = workspaceMetadataStatePath(tempDir, 'retained')
    const state = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    for (const patch of [
      { sessionId: 'other' },
      { workspacePath: 'other' },
      { stepCount: -1 },
      { episodes: [null] },
      { recentFullLogs: [{}] },
      { planMilestones: [{}] },
      { pendingPlanMilestones: [null] },
      { runIdentity: { runId: 'other' } },
      { recoveryFailures: { schema: {} } },
      { chatMessages: [{ role: 'tool' }] },
    ]) {
      const original = JSON.stringify({ ...state, ...patch })
      fs.writeFileSync(filePath, original)
      await expect(agentSessionStateRepository.seedPlanMilestones('retained', tempDir, [])).rejects.toThrow('original data is preserved')
      expect(fs.readFileSync(filePath, 'utf-8')).toBe(original)
    }
  })

  it('distinguishes missing fallback state from invalid retained fallback state', async () => {
    const fallbackDir = path.join(tempDir, 'fallback')
    const repository = new AgentSessionStateRepository(fallbackDir)
    await expect(repository.loadSessionState('fallback', null)).resolves.toBeNull()
    await repository.seedPlanMilestones('fallback', null, [])
    const filePath = path.join(fallbackDir, '.agent_state_fallback.json')
    const valid = fs.readFileSync(filePath, 'utf-8')
    fs.writeFileSync(filePath, '{broken')
    await expect(repository.loadSessionState('fallback', null)).rejects.toThrow('original data is preserved')
    await expect(repository.seedPlanMilestones('fallback', null, [])).rejects.toThrow('original data is preserved')
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('{broken')
    fs.writeFileSync(filePath, valid)
    await expect(repository.loadSessionState('fallback', null)).resolves.toMatchObject({ sessionId: 'fallback' })
  })

  it('blocks tracker projection when its retained state is invalid', async () => {
    const sessionId = 'tracker-invalid-state'
    await agentSessionStateRepository.seedPlanMilestones(sessionId, tempDir, [])
    const tracker = new SessionDebtTracker({ sessionId, completedTasks: ['retained'] })
    await agentSessionStateRepository.saveSessionTrackerMarkdown(tempDir, tracker)
    const trackerPath = workspaceMetadataTrackerPath(tempDir, sessionId)
    const originalTracker = fs.readFileSync(trackerPath)
    fs.writeFileSync(workspaceMetadataStatePath(tempDir, sessionId), '{}')
    await expect(
      agentSessionStateRepository.saveSessionTrackerMarkdown(tempDir, new SessionDebtTracker({ sessionId, completedTasks: ['replacement'] })),
    ).resolves.toBe(false)
    expect(fs.readFileSync(trackerPath)).toEqual(originalTracker)
  })

  it('should save, load, and clear session state correctly', async () => {
    const mockState: SavedAgentSessionState = {
      sessionId: 'session-test-123',
      workspacePath: tempDir,
      agentMode: 'auto',
      stepCount: 5,
      maxSteps: 50,
      episodes: [
        { step: 1, tool: 'read_file', status: 'SUCCESS', summary: 'Read index.html' },
        { step: 2, tool: 'replace_file_content', status: 'FAILURE', summary: 'Target content mismatch' },
      ],
      recentFullLogs: [{ step: 2, tool: 'replace_file_content', output: 'Target content mismatch line 15' }],
      planMilestones: [{ id: 'm1', title: 'Setup structure', status: 'verified' }],
      userTask: 'Fix replace file content bug',
      ollamaRuntimeProfile: {
        model: 'qwen2.5-coder:7b',
        host: 'http://127.0.0.1:11434',
        options: { num_ctx: 4096, num_predict: 1024, maxContextChars: 10000 },
      },
      ollamaGenerationTelemetry: [{ step: 5, model: 'qwen2.5-coder:7b', numCtx: 4096, startedAt: '2026-09-08T00:00:00.000Z', wallDurationMs: 500 }],
      updatedAt: new Date().toISOString(),
    }

    const saved = await agentSessionStateRepository.saveSessionState(mockState)
    expect(saved).toBe(true)

    const loaded = await agentSessionStateRepository.loadSessionState('session-test-123', tempDir)
    expect(loaded).not.toBeNull()
    expect(loaded?.sessionId).toBe('session-test-123')
    expect(loaded?.stepCount).toBe(5)
    expect(loaded?.episodes.length).toBe(2)
    expect(loaded?.episodes[1].status).toBe('FAILURE')
    expect(loaded?.recentFullLogs[0].output).toContain('Target content mismatch')
    expect(loaded?.ollamaRuntimeProfile?.options.num_ctx).toBe(4096)
    expect(loaded?.ollamaGenerationTelemetry?.[0].wallDurationMs).toBe(500)

    const cleared = await agentSessionStateRepository.clearSessionState('session-test-123', tempDir)
    expect(cleared).toBe(true)

    const loadedAfterClear = await agentSessionStateRepository.loadSessionState('session-test-123', tempDir)
    expect(loadedAfterClear).toBeNull()
  })

  it('falls back to guided for an unknown persisted mode', async () => {
    const stateDir = path.join(tempDir, '.onlyrag', 'sessions')
    fs.mkdirSync(stateDir, { recursive: true })
    const base = {
      workspacePath: tempDir,
      stepCount: 0,
      maxSteps: 10,
      episodes: [],
      recentFullLogs: [],
      planMilestones: [],
      userTask: 'Resume',
      updatedAt: new Date().toISOString(),
    }
    fs.writeFileSync(path.join(stateDir, '.agent_state_unknown-mode.json'), JSON.stringify({ ...base, sessionId: 'unknown-mode', agentMode: 'plan' }))

    await expect(agentSessionStateRepository.loadSessionState('unknown-mode', tempDir)).resolves.toMatchObject({ agentMode: 'guided' })
  })

  it('persists the terminal reason as structured state rather than requiring summary parsing', async () => {
    const reasons = ['finish', 'step_budget', 'cancelled', 'timeout', 'circuit_breaker', 'model_silence', 'transport_error', 'protocol_error'] as const

    for (const terminationReason of reasons) {
      const sessionId = `terminal-${terminationReason}`
      await expect(
        agentSessionStateRepository.saveSessionState({
          sessionId,
          workspacePath: tempDir,
          agentMode: 'auto',
          stepCount: 1,
          maxSteps: 50,
          episodes: [],
          recentFullLogs: [],
          planMilestones: [],
          userTask: 'Terminal state test',
          updatedAt: new Date().toISOString(),
          terminationReason,
        }),
      ).resolves.toBe(true)

      await expect(agentSessionStateRepository.loadSessionState(sessionId, tempDir)).resolves.toMatchObject({ terminationReason })
    }
  })

  it('persists the explicit evidence-based completion status', async () => {
    await agentSessionStateRepository.saveSessionState({
      sessionId: 'completion-status',
      workspacePath: tempDir,
      agentMode: 'auto',
      stepCount: 3,
      maxSteps: 50,
      episodes: [],
      recentFullLogs: [],
      planMilestones: [],
      userTask: 'Completion status test',
      updatedAt: new Date().toISOString(),
      terminationReason: 'model_silence',
      completionStatus: 'unverifiable',
      status: 'FAILED',
    })

    await expect(agentSessionStateRepository.loadSessionState('completion-status', tempDir)).resolves.toMatchObject({
      terminationReason: 'model_silence',
      completionStatus: 'unverifiable',
      status: 'FAILED',
    })
  })

  it('should clear all session states in workspace and fallback directories', async () => {
    const s1: SavedAgentSessionState = {
      sessionId: 'session-1',
      workspacePath: tempDir,
      agentMode: 'auto',
      stepCount: 1,
      maxSteps: 50,
      episodes: [],
      recentFullLogs: [],
      planMilestones: [],
      userTask: 'Task 1',
      updatedAt: new Date().toISOString(),
    }
    const s2: SavedAgentSessionState = {
      sessionId: 'session-2',
      workspacePath: tempDir,
      agentMode: 'ask',
      stepCount: 2,
      maxSteps: 50,
      episodes: [],
      recentFullLogs: [],
      planMilestones: [],
      userTask: 'Task 2',
      updatedAt: new Date().toISOString(),
    }

    await agentSessionStateRepository.saveSessionState(s1)
    await agentSessionStateRepository.saveSessionState(s2)

    expect(await agentSessionStateRepository.loadSessionState('session-1', tempDir)).not.toBeNull()
    expect(await agentSessionStateRepository.loadSessionState('session-2', tempDir)).not.toBeNull()

    const clearedAll = await agentSessionStateRepository.clearAllSessionStates(tempDir)
    expect(clearedAll).toBe(true)

    expect(await agentSessionStateRepository.loadSessionState('session-1', tempDir)).toBeNull()
    expect(await agentSessionStateRepository.loadSessionState('session-2', tempDir)).toBeNull()
  })

  it('should save SESSION_TRACKER.md in the format its own parser reads back (regression: a second, plan-shaped format was written on every checkpoint and could not be parsed, leaving the injected debt block empty)', async () => {
    const tracker = new SessionDebtTracker({
      sessionId: 'tracker-session',
      completedTasks: ['m-1: Setup types'],
      unresolvedIssues: ['m-3: Unit tests failing'],
      nextSteps: ['m-2: Add middleware'],
      modifiedFiles: ['src/auth.ts'],
    })

    const savedTracker = await agentSessionStateRepository.saveSessionTrackerMarkdown(tempDir, tracker)
    expect(savedTracker).toBe(true)

    const trackerPath = workspaceMetadataTrackerPath(tempDir, 'tracker-session')
    expect(fs.existsSync(trackerPath)).toBe(true)

    const content = fs.readFileSync(trackerPath, 'utf-8')
    expect(content).toContain('m-1: Setup types')
    expect(content).toContain('m-2: Add middleware')
    expect(content).toContain('src/auth.ts')

    // The round trip is the point: what is written must survive being parsed back.
    const reparsed = SessionDebtTracker.parseTrackerMarkdown(content)
    expect(reparsed.getData().completedTasks).toContain('m-1: Setup types')
    expect(reparsed.getData().unresolvedIssues).toContain('m-3: Unit tests failing')
    expect(reparsed.getData().nextSteps).toContain('m-2: Add middleware')
    expect(reparsed.getData().modifiedFiles).toContain('src/auth.ts')
    expect(reparsed.compilePromptBlock()).toContain('m-3: Unit tests failing')
  })

  it('keeps each conversation tracker separate in the same project', async () => {
    await agentSessionStateRepository.saveSessionTrackerMarkdown(tempDir, new SessionDebtTracker({ sessionId: 'first', completedTasks: ['first task'] }))
    await agentSessionStateRepository.saveSessionTrackerMarkdown(tempDir, new SessionDebtTracker({ sessionId: 'second', completedTasks: ['second task'] }))

    expect(agentSessionStateRepository.loadSessionTrackerMarkdown(tempDir, 'first')).toContain('first task')
    expect(agentSessionStateRepository.loadSessionTrackerMarkdown(tempDir, 'first')).not.toContain('second task')
    expect(agentSessionStateRepository.loadSessionTrackerMarkdown(tempDir, 'second')).toContain('second task')
    await agentSessionStateRepository.clearSessionState('first', tempDir)
    expect(agentSessionStateRepository.loadSessionTrackerMarkdown(tempDir, 'first')).toBeNull()
    expect(agentSessionStateRepository.loadSessionTrackerMarkdown(tempDir, 'second')).toContain('second task')
  })

  it('should seed a brand new minimal session state when none exists yet', async () => {
    const seeded = await agentSessionStateRepository.seedPlanMilestones(
      'plan-seed-new-session',
      tempDir,
      [{ id: 'm-1', title: 'Design schema', status: 'pending' }],
      'Build the login flow',
    )
    expect(seeded).toBe(true)

    const loaded = await agentSessionStateRepository.loadSessionState('plan-seed-new-session', tempDir)
    expect(loaded).not.toBeNull()
    expect(loaded?.pendingPlanMilestones).toHaveLength(1)
    expect(loaded?.pendingPlanMilestones?.[0].title).toBe('Design schema')
    expect(loaded?.pendingPlanUserTask).toBe('Build the login flow')
    expect(loaded?.stepCount).toBe(0)
  })

  it('should keep an approved plan separate from an existing run state', async () => {
    const existing: SavedAgentSessionState = {
      sessionId: 'plan-seed-existing-session',
      workspacePath: tempDir,
      agentMode: 'auto',
      stepCount: 7,
      maxSteps: 50,
      episodes: [{ step: 1, tool: 'read_file', status: 'SUCCESS', summary: 'Read app.ts' }],
      recentFullLogs: [],
      planMilestones: [{ id: 'old-m1', title: 'Stale milestone', status: 'verified' }],
      userTask: 'Original task',
      updatedAt: new Date().toISOString(),
      status: 'FAILED',
      terminationReason: 'model_silence',
      completionStatus: 'unverifiable',
    }
    await agentSessionStateRepository.saveSessionState(existing)

    const seeded = await agentSessionStateRepository.seedPlanMilestones(
      'plan-seed-existing-session',
      tempDir,
      [{ id: 'm-1', title: 'New approved milestone', status: 'pending' }],
      'Original task\n\n[INTERVIEW DECISIONS]\n- [ACCEPTED RECOMMENDATION] Router: React Router',
      'plan-new:v2',
    )
    expect(seeded).toBe(true)

    const loaded = await agentSessionStateRepository.loadSessionState('plan-seed-existing-session', tempDir)
    expect(loaded?.pendingPlanMilestones).toHaveLength(1)
    expect(loaded?.pendingPlanMilestones?.[0].title).toBe('New approved milestone')
    expect(loaded?.stepCount).toBe(7)
    expect(loaded?.episodes).toHaveLength(1)
    expect(loaded?.pendingPlanUserTask).toContain('[ACCEPTED RECOMMENDATION] Router: React Router')
    expect(loaded?.pendingPlanRevisionId).toBe('plan-new:v2')
    expect(loaded?.status).toBe('FAILED')
    expect(loaded?.terminationReason).toBe('model_silence')
    expect(loaded?.completionStatus).toBe('unverifiable')
  })
})
