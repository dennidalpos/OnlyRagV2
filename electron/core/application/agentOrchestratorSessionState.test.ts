import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { revalidateRestoredMilestones, selectSavedRunState } from './agentOrchestratorSessionState'
import { captureMilestoneFileEvidence } from '../infrastructure/filesystem/workspaceDeliverableProbe'
import type { SavedAgentSessionState } from '../infrastructure/filesystem/agentSessionStateRepository'

const runIdentity = {
  runId: 'run-1',
  conversationId: 'conversation-1',
  planRevisionId: 'plan-1',
  workspaceId: 'workspace:test',
} as const

function savedState(overrides: Partial<SavedAgentSessionState> = {}): SavedAgentSessionState {
  return {
    sessionId: 'conversation-1',
    workspacePath: null,
    agentMode: 'agent',
    stepCount: 3,
    maxSteps: 50,
    episodes: [{ step: 1, tool: 'read_file', status: 'SUCCESS', summary: 'Read file' }],
    recentFullLogs: [],
    planMilestones: [{ id: 'm-1', title: 'Implement change', status: 'in_progress' }],
    userTask: 'Implement change',
    updatedAt: '2026-09-12T00:00:00.000Z',
    status: 'IN_PROGRESS',
    ...overrides,
  }
}

describe('revalidateRestoredMilestones', () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })))

  it('keeps matching fingerprints and invalidates modified files, missing files, and commands', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-resume-'))
    dirs.push(workspace)
    fs.writeFileSync(path.join(workspace, 'fresh.ts'), 'export const fresh = true')
    fs.writeFileSync(path.join(workspace, 'changed.ts'), 'export const changed = false')
    const freshMilestone = { id: 'm-1', title: 'Fresh file', status: 'verified' as const, filePaths: ['fresh.ts'] }
    const changedMilestone = { id: 'm-2', title: 'Changed file', status: 'verified' as const, filePaths: ['changed.ts'] }
    const freshEvidence = captureMilestoneFileEvidence(workspace, freshMilestone)
    const changedEvidence = captureMilestoneFileEvidence(workspace, changedMilestone)
    fs.writeFileSync(path.join(workspace, 'changed.ts'), 'export const changed = true')

    const restored = revalidateRestoredMilestones([
      { ...freshMilestone, fileEvidence: freshEvidence },
      { ...changedMilestone, fileEvidence: changedEvidence },
      { id: 'm-3', title: 'Missing file', status: 'verified', filePaths: ['missing.ts'] },
      { id: 'm-4', title: 'Verified build', status: 'verified', verificationCommand: 'npm test' },
    ], workspace)

    expect(restored.map((item) => item.status)).toEqual(['verified', 'pending', 'pending', 'in_progress'])
    expect(restored[1].notes).toContain('changed')
    expect(restored[3].notes).toContain('rerun verification')
  })

  it('invalidates legacy verified file evidence without a persisted fingerprint', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-resume-'))
    dirs.push(workspace)
    fs.writeFileSync(path.join(workspace, 'legacy.ts'), 'export const legacy = true')

    const [restored] = revalidateRestoredMilestones([
      { id: 'm-1', title: 'Legacy file', status: 'verified', filePaths: ['legacy.ts'] },
    ], workspace)

    expect(restored.status).toBe('pending')
    expect(restored.notes).toContain('changed')
  })
})

describe('selectSavedRunState', () => {
  it('restores only an interrupted state for the matching run', () => {
    const state = savedState({ runIdentity })
    const selection = selectSavedRunState(state, runIdentity)

    expect(selection.executionState).toBe(state)
    expect(selection.planSeed).toEqual([])
  })

  it('resets execution state for a different run in the same conversation', () => {
    const state = savedState({ runIdentity })
    const selection = selectSavedRunState(state, { ...runIdentity, runId: 'run-2' })

    expect(selection.executionState).toBeNull()
    expect(selection.planSeed).toEqual([])
  })

  it('keeps an approved plan as a new-run seed without restoring budgets', () => {
    const state = savedState({
      runIdentity,
      pendingPlanMilestones: [{ id: 'm-2', title: 'Approved plan', status: 'pending' }],
      pendingPlanUserTask: 'Use the approved plan',
    })
    const selection = selectSavedRunState(state, { ...runIdentity, runId: 'run-2', planRevisionId: 'plan-2' })

    expect(selection.executionState).toBeNull()
    expect(selection.planSeed).toEqual([{ id: 'm-2', title: 'Approved plan', status: 'pending' }])
    expect(selection.initialUserTask).toBe('Use the approved plan')
  })
})
