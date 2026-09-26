import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRunIdentity, AgentTaskRequest, WorkspaceFile } from '../../types'
import { useAgentActionLog } from './useAgentActionLog'
import { useCodingAgentExecution, type UseCodingAgentExecutionOptions } from './useCodingAgentExecution'

type Execution = ReturnType<typeof useCodingAgentExecution>
type HarnessProps = Omit<UseCodingAgentExecutionOptions, 'actionLog'>

const fileA: WorkspaceFile = { name: 'a.ts', path: 'C:/w/a.ts', isDir: false } as WorkspaceFile
const fileB: WorkspaceFile = { name: 'b.ts', path: 'C:/w/b.ts', isDir: false } as WorkspaceFile

describe('useCodingAgentExecution', () => {
  let container: HTMLDivElement
  let root: Root
  let execution: Execution
  let doneListener: ((result: { success: boolean; summary: string } & AgentRunIdentity) => void) | undefined
  const startAgentTask = vi.fn(async (request: AgentTaskRequest) => ({ success: true, summary: '', runId: request.identity.runId, queuePosition: 0 }))

  function Harness(props: HarnessProps) {
    const actionLog = useAgentActionLog()
    execution = useCodingAgentExecution({ ...props, actionLog })
    return null
  }

  function props(overrides: Partial<HarnessProps> = {}): HarnessProps {
    return {
      workspacePath: 'C:/w',
      isStandaloneMode: false,
      session: {
        activeSessionId: 'session-1',
        activeSession: { id: 'session-1' } as never,
        beginExecutedPrompt: vi.fn(() => 'prompt-1'),
        completeExecutedPrompt: vi.fn(),
        updateActiveSessionPlans: vi.fn(),
      },
      editor: { selectedFile: fileA, editorContent: 'a', loadedContentHash: 'a'.repeat(64), handleOpenFile: vi.fn(async () => {}) },
      context: { ingestedDocs: [], attachedDocIds: new Set(), pinnedFiles: new Map() },
      appendTerminalLogs: vi.fn(),
      ...overrides,
    }
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    startAgentTask.mockClear()
    doneListener = undefined
    const unsubscribe = () => () => {}
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      startAgentTask,
      cancelAgentTask: vi.fn(async () => ({ success: true })),
      onAgentLog: unsubscribe,
      onAgentStreamToken: unsubscribe,
      onAgentStreamThought: unsubscribe,
      onAgentStepUpdate: unsubscribe,
      onAgentContextBudget: unsubscribe,
      onAgentApprovalRequest: unsubscribe,
      onAgentSkillsMatched: unsubscribe,
      onAgentChangeMetrics: unsubscribe,
      onAgentDone: (listener: typeof doneListener) => {
        doneListener = listener
        return () => {}
      },
    }
    container = document.createElement('div')
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    vi.useRealTimers()
  })

  it('runs an auto-dequeued prompt with the mode, session and editor state current when the previous run ends', async () => {
    await act(async () => root.render(<Harness {...props()} />))
    await act(async () => execution.handleAgentExecute('First task'))
    await act(async () => execution.handleAgentExecute('Queued task'))
    expect(startAgentTask).toHaveBeenCalledTimes(1)
    expect(execution.promptQueue.map((item) => item.prompt)).toEqual(['Queued task'])
    const firstRun = startAgentTask.mock.calls[0][0].identity

    // While the first run is still executing, the user changes mode, conversation and editor file.
    await act(async () => execution.setAgentMode('auto'))
    const laterSession = { ...props().session, activeSessionId: 'session-2' }
    const laterEditor = { selectedFile: fileB, editorContent: 'b', loadedContentHash: 'b'.repeat(64), handleOpenFile: vi.fn(async () => {}) }
    await act(async () => root.render(<Harness {...props({ session: laterSession, editor: laterEditor })} />))

    await act(async () => doneListener?.({ ...firstRun, success: true, summary: 'done' }))
    await act(async () => vi.advanceTimersByTimeAsync(300))

    expect(startAgentTask).toHaveBeenCalledTimes(2)
    const dequeued = startAgentTask.mock.calls[1][0]
    expect(dequeued).toMatchObject({ userTask: 'Queued task', agentMode: 'auto', sessionId: 'session-2', activeFile: { path: 'C:/w/b.ts' } })
    expect(laterSession.beginExecutedPrompt).toHaveBeenCalledWith('session-2', 'Queued task', 'auto')
  })

  it('does not start the next queued prompt after a cancelled run', async () => {
    await act(async () => root.render(<Harness {...props()} />))
    await act(async () => execution.handleAgentExecute('First task'))
    await act(async () => execution.handleAgentExecute('Queued task'))
    const firstRun = startAgentTask.mock.calls[0][0].identity

    await act(async () => doneListener?.({ ...firstRun, success: false, summary: 'stopped', completionStatus: 'cancelled' } as never))
    await act(async () => vi.advanceTimersByTimeAsync(1_000))

    expect(startAgentTask).toHaveBeenCalledTimes(1)
    expect(execution.isExecuting).toBe(false)
  })

  it('ignores completion events of another run identity', async () => {
    await act(async () => root.render(<Harness {...props()} />))
    await act(async () => execution.handleAgentExecute('First task'))
    const firstRun = startAgentTask.mock.calls[0][0].identity

    await act(async () => doneListener?.({ ...firstRun, runId: 'other-run', success: true, summary: 'done' }))

    expect(execution.isExecuting).toBe(true)
  })

  it('resetRunView cancels the active run and clears run-scoped indicators', async () => {
    await act(async () => root.render(<Harness {...props()} />))
    await act(async () => execution.handleAgentExecute('First task'))
    const firstRun = startAgentTask.mock.calls[0][0].identity

    await act(async () => execution.resetRunView())

    expect(window.electronAPI!.cancelAgentTask).toHaveBeenCalledWith(firstRun)
    expect(execution.isExecuting).toBe(false)
    expect(execution.activeRunIdentity).toBeNull()
    expect(execution.currentStep).toBe(0)
  })
})
