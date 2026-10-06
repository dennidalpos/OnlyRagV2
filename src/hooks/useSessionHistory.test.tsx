import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { AgentPlan, CodingSession } from '../types'
import { useSessionHistory } from './useSessionHistory'

type History = ReturnType<typeof useSessionHistory>

describe('useSessionHistory persistence', () => {
  let container: HTMLDivElement
  let root: Root
  let history: History
  const saveCodingSession = vi.fn<(session: CodingSession) => Promise<CodingSession | null>>(async (session) => session)

  function Harness() {
    history = useSessionHistory('C:/workspace')
    return null
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      saveCodingSession,
      listCodingSessions: vi.fn(async () => []),
    }
    saveCodingSession.mockReset().mockImplementation(async (session) => session)
    container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root.render(<Harness />))
    await act(async () => vi.runAllTimersAsync())
    saveCodingSession.mockClear()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    vi.useRealTimers()
  })

  it('coalesces a burst of log updates into a single write of the latest state', async () => {
    const sessionId = history.activeSessionId
    await act(async () => {
      for (let i = 1; i <= 50; i++) {
        history.updateSessionContent(sessionId, { actionLogs: Array.from({ length: i }, (_, n) => ({ id: `log-${n}` }) as never) })
      }
    })
    expect(saveCodingSession).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTimeAsync(600))
    expect(saveCodingSession).toHaveBeenCalledTimes(1)
    expect(saveCodingSession.mock.calls[0][0].actionLogs).toHaveLength(50)
  })

  it('shows a failed load without creating a replacement session, then retries', async () => {
    await act(async () => root.unmount())
    root = createRoot(container)
    const list = vi.fn().mockRejectedValue(new Error('Unreadable retained store'))
    ;(window as unknown as { electronAPI: unknown }).electronAPI = { saveCodingSession, listCodingSessions: list }
    await act(async () => root.render(<Harness />))
    expect(history.storageFailed).toBe(true)
    expect(history.isLoadingSessions).toBe(false)
    expect(history.sessions).toEqual([])
    expect(history.activeSessionId).toBe('')
    expect(saveCodingSession).not.toHaveBeenCalled()
    list.mockResolvedValue([])
    await act(async () => history.retryStorage())
    expect(history.storageFailed).toBe(false)
    expect(history.sessions).toHaveLength(1)
  })

  it.each(['reject', 'false'])('retains failed session changes and retries acknowledgement: %s', async (failure) => {
    if (failure === 'reject') saveCodingSession.mockRejectedValueOnce(new Error('Read blocked'))
    else saveCodingSession.mockResolvedValueOnce(null)
    const sessionId = history.activeSessionId
    const logs = [{ id: 'retained', timestamp: '2026-10-06T00:00:00Z', type: 'info' as const, message: 'Retained change' }]
    await act(async () => history.updateSessionContent(sessionId, { actionLogs: logs }))
    await act(async () => vi.advanceTimersByTimeAsync(600))
    expect(history.storageFailed).toBe(true)
    expect(history.activeSession?.actionLogs).toEqual(logs)
    vi.mocked(window.electronAPI!.listCodingSessions).mockImplementation(async () => [saveCodingSession.mock.calls.at(-1)![0]])
    await act(async () => history.retryStorage())
    expect(saveCodingSession).toHaveBeenCalledTimes(2)
    expect(history.storageFailed).toBe(false)
    expect(history.activeSession?.actionLogs).toEqual(logs)
  })

  it('flushes the pending write on unmount instead of dropping it', async () => {
    const sessionId = history.activeSessionId
    await act(async () => history.updateSessionContent(sessionId, { actionLogs: [{ id: 'last-log' } as never] }))
    await act(async () => root.unmount())
    await act(async () => Promise.resolve())
    expect(saveCodingSession).toHaveBeenCalledWith(expect.objectContaining({ actionLogs: [{ id: 'last-log' }] }))
    root = createRoot(container)
  })

  it('persists a plan revision with JSON-safe action logs', async () => {
    const sessionId = history.activeSessionId
    const plan: AgentPlan = {
      formatVersion: 2,
      id: 'plan-1',
      version: 1,
      prompt: 'Build the page',
      objective: 'Build the page',
      decisions: [],
      retainedEvidence: [],
      milestones: [{ id: 'step-1', title: 'Create the page', status: 'pending' }],
      supersededWork: [],
      status: 'approved',
      createdAt: new Date().toISOString(),
    }

    await act(async () => {
      history.updateSessionContent(sessionId, {
        actionLogs: [{ id: 'log-1', timestamp: '10:00:00', type: 'info', message: 'Automatic planning started', detail: undefined }],
      })
    })

    let persisted = false
    await act(async () => {
      persisted = await history.persistSessionPlan(sessionId, plan)
    })

    expect(persisted).toBe(true)
    expect(saveCodingSession).toHaveBeenCalledTimes(1)
    const payload = saveCodingSession.mock.calls[0][0]
    expect(z.json().safeParse(payload.actionLogs[0]).success).toBe(true)
    expect(payload.plans?.[0]).toEqual(plan)
  })

  it('does not retry a failed snapshot after confirmed deletion', async () => {
    saveCodingSession.mockRejectedValueOnce(new Error('Failed write'))
    await act(async () => history.updateSessionContent(history.activeSessionId, { actionLogs: [{ id: 'retained' } as never] }))
    await act(async () => vi.advanceTimersByTimeAsync(600))
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      saveCodingSession,
      listCodingSessions: vi.fn(async () => []),
      deleteCodingSession: vi.fn(async () => true),
    }
    await act(async () => history.deleteSession(history.activeSessionId))
    await act(async () => history.retryStorage())
    expect(saveCodingSession).toHaveBeenCalledTimes(1)
    expect(history.storageFailed).toBe(false)
  })
})
