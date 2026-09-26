import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodingSession } from '../types'
import { useSessionHistory } from './useSessionHistory'

type History = ReturnType<typeof useSessionHistory>

describe('useSessionHistory persistence', () => {
  let container: HTMLDivElement
  let root: Root
  let history: History
  const saveCodingSession = vi.fn(async (session: CodingSession) => session)

  function Harness() {
    history = useSessionHistory('C:/workspace')
    return null
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    localStorage.setItem('onlyrag_sessions_migrated_to_filesystem_v1', 'done')
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      saveCodingSession,
      listCodingSessions: vi.fn(async () => []),
    }
    saveCodingSession.mockClear()
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

  it('flushes the pending write on unmount instead of dropping it', async () => {
    const sessionId = history.activeSessionId
    await act(async () => history.updateSessionContent(sessionId, { actionLogs: [{ id: 'last-log' } as never] }))
    await act(async () => root.unmount())
    await act(async () => Promise.resolve())
    expect(saveCodingSession).toHaveBeenCalledWith(expect.objectContaining({ actionLogs: [{ id: 'last-log' }] }))
    root = createRoot(container)
  })
})
