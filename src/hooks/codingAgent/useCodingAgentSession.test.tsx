import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodingSession, IngestedDocument } from '../../types'
import { useCodingAgentSession, type UseCodingAgentSessionOptions } from './useCodingAgentSession'

vi.mock('../useIngestedDocuments', () => ({
  useIngestedDocuments: ({ onDocsUpdated }: { onDocsUpdated: (docs: IngestedDocument[]) => void }) => {
    ingestedDocsHook.onDocsUpdated = onDocsUpdated
    return { documents: ingestedDocsHook.documents }
  },
}))

const ingestedDocsHook: { documents: IngestedDocument[]; onDocsUpdated?: (docs: IngestedDocument[]) => void } = { documents: [] }

import { useCodingAgentAttachments } from './useCodingAgentAttachments'

type SessionApi = ReturnType<typeof useCodingAgentSession>

function session(id: string, logs: string[] = []): CodingSession {
  return {
    id,
    title: id,
    createdAt: '',
    updatedAt: '',
    actionLogs: logs.map((message) => ({ id: message, message })),
    executedPrompts: [],
  } as unknown as CodingSession
}

describe('useCodingAgentSession', () => {
  let container: HTMLDivElement
  let root: Root
  let api: SessionApi
  let options: UseCodingAgentSessionOptions

  function Harness(props: UseCodingAgentSessionOptions) {
    api = useCodingAgentSession(props)
    return null
  }

  function buildOptions(activeSessionId: string, activeSession: CodingSession | null, workspacePath = 'C:/w'): UseCodingAgentSessionOptions {
    return {
      workspacePath,
      history: {
        sessions: activeSession ? [activeSession] : [],
        activeSession,
        activeSessionId,
        updateSessionContent: vi.fn(),
        createSession: vi.fn(),
        switchSession: vi.fn(),
        deleteSession: vi.fn(),
        renameSession: vi.fn(),
        purgeWorkspace: vi.fn(),
      } as unknown as UseCodingAgentSessionOptions['history'],
      execution: {
        resetRunView: vi.fn(),
        clearConversation: vi.fn(),
        hydrateFromSession: vi.fn(),
        promptQueue: [],
        contextBudget: null,
        forceContextCompaction: false,
      },
      actionLogs: [],
      clearRunContext: vi.fn(),
      selectProject: vi.fn(),
      removeProject: vi.fn(),
    }
  }

  beforeEach(() => {
    container = document.createElement('div')
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
  })

  it('hydrates the execution view once per conversation switch and persists only the hydrated conversation', async () => {
    const first = session('s1', ['a'])
    options = buildOptions('s1', first)
    await act(async () => root.render(<Harness {...options} />))
    expect(options.execution.hydrateFromSession).toHaveBeenCalledWith(first)

    await act(async () => root.render(<Harness {...options} actionLogs={[{ id: 'b' } as never]} />))
    expect(options.history.updateSessionContent).toHaveBeenLastCalledWith('s1', expect.objectContaining({ actionLogs: [{ id: 'b' }] }))

    const second = session('s2')
    const next = { ...options, history: { ...options.history, activeSessionId: 's2', activeSession: second } }
    await act(async () => root.render(<Harness {...next} />))
    expect(options.execution.hydrateFromSession).toHaveBeenCalledTimes(2)
    expect(options.execution.hydrateFromSession).toHaveBeenLastCalledWith(second)
  })

  it('clears the run, conversation and per-conversation context when creating or deleting the active conversation', async () => {
    options = buildOptions('s1', session('s1'))
    await act(async () => root.render(<Harness {...options} />))

    act(() => api.handleCreateSession())
    expect(options.execution.resetRunView).toHaveBeenCalledTimes(1)
    expect(options.execution.clearConversation).toHaveBeenCalledTimes(1)
    expect(options.clearRunContext).toHaveBeenCalledTimes(1)
    expect(options.history.createSession).toHaveBeenCalledTimes(1)

    act(() => api.handleDeleteSession('other'))
    expect(options.clearRunContext).toHaveBeenCalledTimes(1)
    act(() => api.handleDeleteSession('s1'))
    expect(options.clearRunContext).toHaveBeenCalledTimes(2)
    expect(options.history.deleteSession).toHaveBeenLastCalledWith('s1')
  })

  it('switching keeps attachments but detaches the running agent', async () => {
    options = buildOptions('s1', session('s1'))
    await act(async () => root.render(<Harness {...options} />))

    act(() => api.handleSwitchSession('s1'))
    expect(options.execution.resetRunView).not.toHaveBeenCalled()
    act(() => api.handleSwitchSession('s2'))
    expect(options.execution.resetRunView).toHaveBeenCalledTimes(1)
    expect(options.clearRunContext).not.toHaveBeenCalled()
    expect(options.history.switchSession).toHaveBeenCalledWith('s2')
  })

  it('removing the active project purges its sessions, resets the view and unregisters it', async () => {
    options = buildOptions('s1', session('s1'), 'C:/w')
    await act(async () => root.render(<Harness {...options} />))

    act(() => api.handleRemoveProject('C:/other'))
    expect(options.execution.resetRunView).not.toHaveBeenCalled()
    act(() => api.handleRemoveProject('C:/w'))
    expect(options.history.purgeWorkspace).toHaveBeenCalledWith('C:/w')
    expect(options.execution.resetRunView).toHaveBeenCalledTimes(1)
    expect(options.removeProject).toHaveBeenLastCalledWith('C:/w')
  })
})

describe('useCodingAgentAttachments', () => {
  let container: HTMLDivElement
  let root: Root
  let attachments: ReturnType<typeof useCodingAgentAttachments>

  function Harness() {
    attachments = useCodingAgentAttachments()
    return null
  }

  beforeEach(async () => {
    ingestedDocsHook.documents = [
      { id: 'doc-1', filename: 'a.pdf', filePath: 'C:/w/docs/a.pdf' },
      { id: 'doc-2', filename: 'b.pdf', filePath: 'C:/elsewhere/b.pdf' },
    ] as IngestedDocument[]
    container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root.render(<Harness />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
  })

  it('toggles attachments and drops ids that leave the document store', async () => {
    act(() => attachments.toggleAttachDoc('doc-1'))
    act(() => attachments.toggleAttachDoc('doc-2'))
    expect([...attachments.attachedDocIds]).toEqual(['doc-1', 'doc-2'])

    act(() => ingestedDocsHook.onDocsUpdated?.([ingestedDocsHook.documents[1]]))
    expect([...attachments.attachedDocIds]).toEqual(['doc-2'])

    act(() => attachments.toggleAttachDoc('doc-2'))
    expect(attachments.attachedDocIds.size).toBe(0)
  })

  it('detaches documents whose source lies inside a deleted path', async () => {
    act(() => attachments.toggleAttachDoc('doc-1'))
    act(() => attachments.toggleAttachDoc('doc-2'))

    act(() => attachments.handlePathPurged((filePath) => filePath.startsWith('C:/w/docs')))

    expect([...attachments.attachedDocIds]).toEqual(['doc-2'])
  })
})
