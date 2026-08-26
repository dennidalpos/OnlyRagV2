import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { SessionDebtTracker } from '../../domain/agent/sessionDebtTracker'
import { agentSessionStateRepository, SavedAgentSessionState } from './agentSessionStateRepository'

describe('AgentSessionStateRepository Unit Tests', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-session-test-'))
  })

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('should save, load, and clear session state correctly', async () => {
    const mockState: SavedAgentSessionState = {
      sessionId: 'session-test-123',
      workspacePath: tempDir,
      agentMode: 'agent',
      stepCount: 5,
      maxSteps: 50,
      episodes: [
        { step: 1, tool: 'read_file', status: 'SUCCESS', summary: 'Read index.html' },
        { step: 2, tool: 'replace_file_content', status: 'FAILURE', summary: 'Target content mismatch' },
      ],
      recentFullLogs: [
        { step: 2, tool: 'replace_file_content', output: 'Target content mismatch line 15' },
      ],
      planMilestones: [
        { id: 'm1', title: 'Setup structure', status: 'verified' },
      ],
      userTask: 'Fix replace file content bug',
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

    const cleared = await agentSessionStateRepository.clearSessionState('session-test-123', tempDir)
    expect(cleared).toBe(true)

    const loadedAfterClear = await agentSessionStateRepository.loadSessionState('session-test-123', tempDir)
    expect(loadedAfterClear).toBeNull()
  })

  it('persists the terminal reason as structured state rather than requiring summary parsing', async () => {
    const reasons = ['finish', 'step_budget', 'cancelled', 'timeout', 'circuit_breaker'] as const

    for (const terminationReason of reasons) {
      const sessionId = `terminal-${terminationReason}`
      await expect(
        agentSessionStateRepository.saveSessionState({
          sessionId,
          workspacePath: tempDir,
          agentMode: 'agent',
          stepCount: 1,
          maxSteps: 50,
          episodes: [],
          recentFullLogs: [],
          planMilestones: [],
          userTask: 'Terminal state test',
          updatedAt: new Date().toISOString(),
          terminationReason,
        })
      ).resolves.toBe(true)

      await expect(agentSessionStateRepository.loadSessionState(sessionId, tempDir)).resolves.toMatchObject({ terminationReason })
    }
  })

  it('should clear all session states in workspace and fallback directories', async () => {
    const s1: SavedAgentSessionState = {
      sessionId: 'session-1',
      workspacePath: tempDir,
      agentMode: 'agent',
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

    const trackerPath = path.join(tempDir, '.onlyrag', 'assistant', 'SESSION_TRACKER.md')
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

  it('should seed a brand new minimal session state when none exists yet', async () => {
    const seeded = await agentSessionStateRepository.seedPlanMilestones(
      'plan-seed-new-session',
      tempDir,
      [{ id: 'm-1', title: 'Design schema', status: 'pending' }],
      'Build the login flow'
    )
    expect(seeded).toBe(true)

    const loaded = await agentSessionStateRepository.loadSessionState('plan-seed-new-session', tempDir)
    expect(loaded).not.toBeNull()
    expect(loaded?.planMilestones).toHaveLength(1)
    expect(loaded?.planMilestones[0].title).toBe('Design schema')
    expect(loaded?.userTask).toBe('Build the login flow')
    expect(loaded?.stepCount).toBe(0)
  })

  it('should migrate a pre-unification .assistant/SESSION_TRACKER.md into .onlyrag/assistant/ on first write', async () => {
    const legacyDir = path.join(tempDir, '.assistant')
    fs.mkdirSync(legacyDir, { recursive: true })
    fs.writeFileSync(path.join(legacyDir, 'SESSION_TRACKER.md'), '# Legacy tracker content', 'utf-8')

    const tracker = new SessionDebtTracker({
      sessionId: 'migration-session',
      completedTasks: [],
      unresolvedIssues: [],
      nextSteps: [],
      modifiedFiles: [],
    })
    const saved = await agentSessionStateRepository.saveSessionTrackerMarkdown(tempDir, tracker)
    expect(saved).toBe(true)

    const newPath = path.join(tempDir, '.onlyrag', 'assistant', 'SESSION_TRACKER.md')
    expect(fs.existsSync(newPath)).toBe(true)
    // The freshly written tracker (not the legacy content) must win at the new path.
    expect(fs.readFileSync(newPath, 'utf-8')).not.toContain('Legacy tracker content')
  })

  it('should migrate pre-unification .agent_state_*.json files out of the flat .onlyrag/ folder into .onlyrag/sessions/', async () => {
    const legacyOnlyragDir = path.join(tempDir, '.onlyrag')
    fs.mkdirSync(legacyOnlyragDir, { recursive: true })
    fs.writeFileSync(
      path.join(legacyOnlyragDir, '.agent_state_legacy-migrated-session.json'),
      JSON.stringify({ sessionId: 'legacy-migrated-session', stepCount: 3 }),
      'utf-8'
    )

    const loaded = await agentSessionStateRepository.loadSessionState('legacy-migrated-session', tempDir)
    expect(loaded).not.toBeNull()
    expect(loaded?.stepCount).toBe(3)
    expect(fs.existsSync(path.join(legacyOnlyragDir, '.agent_state_legacy-migrated-session.json'))).toBe(false)
    expect(fs.existsSync(path.join(legacyOnlyragDir, 'sessions', '.agent_state_legacy-migrated-session.json'))).toBe(true)
  })

  it('should merge seeded milestones into an existing session state without discarding other fields', async () => {
    const existing: SavedAgentSessionState = {
      sessionId: 'plan-seed-existing-session',
      workspacePath: tempDir,
      agentMode: 'agent',
      stepCount: 7,
      maxSteps: 50,
      episodes: [{ step: 1, tool: 'read_file', status: 'SUCCESS', summary: 'Read app.ts' }],
      recentFullLogs: [],
      planMilestones: [{ id: 'old-m1', title: 'Stale milestone', status: 'verified' }],
      userTask: 'Original task',
      updatedAt: new Date().toISOString(),
    }
    await agentSessionStateRepository.saveSessionState(existing)

    const seeded = await agentSessionStateRepository.seedPlanMilestones(
      'plan-seed-existing-session',
      tempDir,
      [{ id: 'm-1', title: 'New approved milestone', status: 'pending' }],
      'Original task'
    )
    expect(seeded).toBe(true)

    const loaded = await agentSessionStateRepository.loadSessionState('plan-seed-existing-session', tempDir)
    expect(loaded?.planMilestones).toHaveLength(1)
    expect(loaded?.planMilestones[0].title).toBe('New approved milestone')
    // Other fields (step count, episodes) must survive the seed merge.
    expect(loaded?.stepCount).toBe(7)
    expect(loaded?.episodes).toHaveLength(1)
  })
})
