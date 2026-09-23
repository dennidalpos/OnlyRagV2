import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: any[]) => any>()

vi.mock('electron', async (importOriginal) => ({
  ...(await importOriginal<typeof import('electron')>()),
  app: { getPath: vi.fn(() => process.cwd()) },
  BrowserWindow: class {},
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler)
    }),
  },
}))

vi.mock('../application/taskQueueAppService', () => ({
  taskQueueAppService: {
    scheduleAgentTask: vi.fn(),
    cancelTask: vi.fn(),
    getQueueStatus: vi.fn(),
  },
}))
vi.mock('../application/agentOrchestratorAppService', () => ({ respondToApproval: vi.fn() }))
vi.mock('../domain/agent/toolParser', () => ({ parseAgentToolCall: vi.fn() }))
vi.mock('../application/sidecarAppService', () => ({ sidecarAppService: {} }))
vi.mock('../application/planGenerationAppService', () => ({
  planGenerationAppService: {
    generatePlanText: vi.fn(),
  },
}))
vi.mock('../application/aiDebugBundleService', () => ({ aiDebugBundleService: {} }))
vi.mock('../application/agentInterviewAppService', () => ({
  agentInterviewAppService: { conductInterview: vi.fn(), enrichPromptWithAnswers: vi.fn() },
}))
vi.mock('../application/agentSessionStateAppService', () => ({
  agentSessionStateAppService: {
    loadSessionState: vi.fn(),
    seedPlanMilestones: vi.fn(),
  },
}))

import { agentSessionStateAppService } from '../application/agentSessionStateAppService'
import { respondToApproval } from '../application/agentOrchestratorAppService'
import { planGenerationAppService } from '../application/planGenerationAppService'
import { agentInterviewAppService } from '../application/agentInterviewAppService'
import { taskQueueAppService } from '../application/taskQueueAppService'
import { parseAgentTaskPayload, registerAgentIpcHandlers } from './agentIpc'
import { setTrustedIpcWindowProvider } from './secureIpcMain'

const trustedContents = { mainFrame: {} }
const trustedEvent = { sender: trustedContents, senderFrame: trustedContents.mainFrame }

describe('agent IPC session-state facade', () => {
  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
    setTrustedIpcWindowProvider(() => ({ webContents: trustedContents }) as never)
    registerAgentIpcHandlers(() => null)
  })

  it('projects persisted session state for the renderer', async () => {
    vi.mocked(agentSessionStateAppService.loadSessionState).mockResolvedValue({
      sessionId: 'session-1',
      status: 'completed',
      stepCount: 4,
      planMilestones: [{ id: 'm-1', title: 'Build app', status: 'completed' }],
    } as never)

    await expect(handlers.get('agent:get-plan-state')?.(trustedEvent, 'session-1', '/repo')).resolves.toEqual({
      planMilestones: [{ id: 'm-1', title: 'Build app', status: 'completed' }],
      status: 'completed',
      stepCount: 4,
    })
    expect(agentSessionStateAppService.loadSessionState).toHaveBeenCalledWith('session-1', '/repo')
  })

  it('forwards the complete immutable identity for run commands', async () => {
    const identity = {
      runId: 'run-1',
      conversationId: 'conversation-1',
      planRevisionId: 'plan-1:v2',
      workspaceId: 'workspace-1',
    }
    const payload = { identity, sessionId: identity.conversationId, userTask: 'Inspect', agentMode: 'ask' }

    await handlers.get('agent:start-task')?.(trustedEvent, payload)
    await handlers.get('agent:cancel-task')?.(trustedEvent, identity)
    await handlers.get('agent:approval-response')?.(trustedEvent, identity, true, [0])

    expect(taskQueueAppService.scheduleAgentTask).toHaveBeenCalledWith({ ...payload, activeFile: null }, expect.any(Function))
    expect(taskQueueAppService.cancelTask).toHaveBeenCalledWith(identity)
    expect(respondToApproval).toHaveBeenCalledWith(identity, true, [0])
  })

  it('rejects external senders, subframes, and malformed payloads before dispatch', async () => {
    const handler = handlers.get('agent:cancel-task')!
    expect(() => handler({ sender: {}, senderFrame: trustedContents.mainFrame }, { runId: 'x' })).toThrow('Untrusted IPC sender')
    expect(() => handler({ sender: trustedContents, senderFrame: {} }, { runId: 'x' })).toThrow('Untrusted IPC sender')
    expect(() => handler(trustedEvent, 'not an identity')).toThrow('Invalid IPC payload')
    expect(taskQueueAppService.cancelTask).not.toHaveBeenCalled()
  })

  it('accepts exactly one versioned active-file context and discards legacy contextFiles', () => {
    const payload = parseAgentTaskPayload({
      userTask: 'Inspect the editor file',
      agentMode: 'ask',
      activeFile: {
        name: 'app.ts',
        path: 'D:/repo/app.ts',
        content: 'export const app = true',
        versionHash: 'a'.repeat(64),
      },
      contextFiles: [{ path: 'ignored.ts' }],
    })

    expect(payload.activeFile).toMatchObject({ path: 'D:/repo/app.ts', versionHash: 'a'.repeat(64) })
    expect(payload).not.toHaveProperty('contextFiles')
    expect(() => parseAgentTaskPayload({ userTask: 'Inspect', agentMode: 'ask', activeFile: { path: 'app.ts', content: '', versionHash: 'bad' } })).toThrow(
      'Invalid activeFile contract',
    )
  })

  it('defaults to Guided and rejects removed execution modes', () => {
    expect(parseAgentTaskPayload({ userTask: 'Inspect' }).agentMode).toBe('guided')
    expect(() => parseAgentTaskPayload({ userTask: 'Inspect', agentMode: 'agent' })).toThrow()
    expect(() => parseAgentTaskPayload({ userTask: 'Inspect', agentMode: 'plan' })).toThrow()
  })

  it('accepts the explicit backend context-compaction flag', () => {
    expect(parseAgentTaskPayload({ userTask: 'Inspect', agentMode: 'guided', forceContextCompaction: true }).forceContextCompaction).toBe(true)
  })

  it('returns null when no persisted session state exists and forwards plan seeding', async () => {
    vi.mocked(agentSessionStateAppService.loadSessionState).mockResolvedValue(null)
    vi.mocked(agentSessionStateAppService.seedPlanMilestones).mockResolvedValue(true)
    const milestones = [{ id: 'm-1', title: 'Build app', status: 'pending' as const }]

    await expect(handlers.get('agent:get-plan-state')?.(trustedEvent, 'missing', null)).resolves.toBeNull()
    await expect(handlers.get('agent:plan-seed')?.(trustedEvent, 'session-1', '/repo', milestones, 'Build app', 'plan-1:v1')).resolves.toBe(true)
    expect(agentSessionStateAppService.seedPlanMilestones).toHaveBeenCalledWith('session-1', '/repo', milestones, 'Build app', 'plan-1:v1')
  })

  it('forwards workspace context and prior decisions to interview and planning', async () => {
    const settings = {} as any
    const decisions = [{ questionId: 'q1', questionText: 'Storage', selectedOption: 'Local' }]

    await handlers.get('agent:plan-interview')?.(trustedEvent, 'Build app', 'model', settings, '/repo', decisions)
    const previousPlan = {
      formatVersion: 2,
      id: 'plan-1',
      version: 1,
      prompt: 'Build app',
      objective: 'Build app',
      decisions: [],
      retainedEvidence: [],
      supersededWork: [],
      status: 'ready',
      createdAt: '2026-09-23T00:00:00.000Z',
      milestones: [],
    }
    await handlers.get('agent:plan-generate')?.(trustedEvent, 'Build app', 'model', settings, previousPlan, '/repo', decisions)

    expect(agentInterviewAppService.conductInterview).toHaveBeenCalledWith('Build app', 'model', settings, '/repo', decisions)
    expect(planGenerationAppService.generatePlanText).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath: '/repo',
        previousDecisions: decisions,
        previousPlan,
      }),
    )
  })

  it('forwards the current question set when enriching answers', async () => {
    const answers = [{ questionId: 'q1', questionText: 'Storage?', selectedOption: 'SQLite', provenance: 'explicit' }]
    const questions = [{ id: 'q1', question: 'Storage?', rationale: 'Changes persistence.', options: ['SQLite', 'JSON'], recommendedIndex: 0 }]

    await handlers.get('agent:plan-enrich-prompt')?.(trustedEvent, 'Build app', answers, questions)

    expect(agentInterviewAppService.enrichPromptWithAnswers).toHaveBeenCalledWith('Build app', answers, questions)
  })
})
