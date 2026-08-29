import { describe, it, expect } from 'vitest'
import {
  deriveSessionTitle,
  normalizeSession,
  sortSessionsByRecency,
  toIsoTimestamp,
  upsertSession,
} from './sessionHistoryDomain'
import type { CodingSession } from '../../../../shared/types'

describe('SessionHistoryDomain Unit Tests', () => {
  it('should keep ISO timestamps and replace unparsable legacy clock times with the fallback', () => {
    const fallback = '2026-01-01T00:00:00.000Z'
    expect(toIsoTimestamp('2026-02-03T10:15:00.000Z', fallback)).toBe('2026-02-03T10:15:00.000Z')
    // Legacy value written with toLocaleTimeString: unrecoverable, must not become "Invalid Date".
    expect(toIsoTimestamp('14:32', fallback)).toBe(fallback)
    expect(toIsoTimestamp(undefined, fallback)).toBe(fallback)
  })

  it('should derive a truncated session title from the first prompt', () => {
    expect(deriveSessionTitle('  Fix   the login bug ')).toBe('Fix the login bug')
    expect(deriveSessionTitle('x'.repeat(80))).toBe(`${'x'.repeat(48)}...`)
    expect(deriveSessionTitle('   ')).toBe('Nuova Sessione')
  })

  it('should migrate a legacy session: ISO timestamps, prompts rebuilt from logs, derived title', () => {
    const normalized = normalizeSession({
      id: 'session-legacy-1',
      workspacePath: 'D:/projects/demo',
      title: 'Nuova Sessione',
      createdAt: '14:32',
      updatedAt: '14:40',
      actionLogs: [
        { id: '1', timestamp: '14:32', type: 'info', message: 'User Prompt: Refactor the ingestion service' },
        { id: '2', timestamp: '14:33', type: 'tool_call', message: '[ToolCall: read_file] ingest_service.py' },
        { id: '3', timestamp: '14:39', type: 'info', message: 'User Prompt: Add unit tests' },
      ],
    })

    expect(normalized).not.toBeNull()
    expect(Number.isNaN(Date.parse(normalized!.createdAt))).toBe(false)
    expect(Number.isNaN(Date.parse(normalized!.updatedAt))).toBe(false)
    expect(normalized!.executedPrompts).toHaveLength(2)
    expect(normalized!.executedPrompts[0].prompt).toBe('Refactor the ingestion service')
    expect(normalized!.executedPrompts[0].outcome).toBe('unknown')
    expect(normalized!.executedPrompts[1].sessionId).toBe('session-legacy-1')
    expect(normalized!.title).toBe('Refactor the ingestion service')
  })

  it('should preserve a user-defined title and already recorded executed prompts', () => {
    const normalized = normalizeSession({
      id: 'session-2',
      workspacePath: null,
      title: 'Sprint 42',
      createdAt: '2026-03-01T08:00:00.000Z',
      updatedAt: '2026-03-01T09:00:00.000Z',
      actionLogs: [],
      executedPrompts: [
        {
          id: 'p1',
          sessionId: 'session-2',
          prompt: 'Ship the release',
          startedAt: '2026-03-01T08:05:00.000Z',
          completedAt: '2026-03-01T08:30:00.000Z',
          agentMode: 'agent',
          outcome: 'success',
          totalSteps: 12,
          filesTouched: 3,
          additions: 40,
          deletions: 7,
        },
      ],
    })

    expect(normalized!.title).toBe('Sprint 42')
    expect(normalized!.workspacePath).toBeNull()
    expect(normalized!.executedPrompts).toHaveLength(1)
    expect(normalized!.executedPrompts[0].outcome).toBe('success')
    expect(normalized!.executedPrompts[0].additions).toBe(40)
  })

  it('should normalize plan records: ISO timestamps, valid status, milestones preserved', () => {
    const normalized = normalizeSession({
      id: 'session-plans',
      workspacePath: null,
      title: 'Sprint 7',
      createdAt: '2026-04-02T09:00:00.000Z',
      updatedAt: '2026-04-02T09:30:00.000Z',
      actionLogs: [],
      executedPrompts: [],
      plans: [
        {
          id: 'plan_1',
          version: 1,
          prompt: 'Add caching',
          planText: '1. Add cache layer',
          status: 'approved',
          createdAt: '09:15',
          baseStepOffset: 3,
          milestones: [{ id: 'm1', title: 'Add cache layer', status: 'verified' }],
        },
        { id: 'plan_2', version: 2, prompt: 'x', planText: 'text', status: 'bogus', createdAt: '2026-04-02T09:20:00.000Z' },
        { id: 'plan_broken', version: 3 },
      ],
    })

    expect(normalized!.plans).toHaveLength(2)
    // Legacy clock time is unparsable and falls back to the session's creation date.
    expect(normalized!.plans![0].createdAt).toBe('2026-04-02T09:00:00.000Z')
    expect(normalized!.plans![0].status).toBe('approved')
    expect(normalized!.plans![0].baseStepOffset).toBe(3)
    expect(normalized!.plans![0].milestones).toHaveLength(1)
    // An unknown status degrades to 'ready' instead of poisoning the plan panel.
    expect(normalized!.plans![1].status).toBe('ready')
  })

  it('should reject records without an id', () => {
    expect(normalizeSession({ title: 'Orphan' })).toBeNull()
    expect(normalizeSession(null)).toBeNull()
  })

  it('should upsert by id and sort by most recent update', () => {
    const base: CodingSession = {
      id: 'a',
      workspacePath: null,
      title: 'A',
      createdAt: '2026-01-01T10:00:00.000Z',
      updatedAt: '2026-01-01T10:00:00.000Z',
      actionLogs: [],
      executedPrompts: [],
      promptQueue: [],
    }
    const other: CodingSession = { ...base, id: 'b', title: 'B', updatedAt: '2026-01-02T10:00:00.000Z' }

    const withNew = upsertSession([base], other)
    expect(withNew).toHaveLength(2)

    const updated = upsertSession(withNew, { ...base, title: 'A2' })
    expect(updated).toHaveLength(2)
    expect(updated.find((s) => s.id === 'a')?.title).toBe('A2')

    expect(sortSessionsByRecency(updated).map((s) => s.id)).toEqual(['b', 'a'])
  })
})
