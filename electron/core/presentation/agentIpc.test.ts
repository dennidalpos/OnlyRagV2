import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: any[]) => any>()

vi.mock('electron', async (importOriginal) => ({
  ...await importOriginal<typeof import('electron')>(),
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
import { registerAgentIpcHandlers } from './agentIpc'

describe('agent IPC session-state facade', () => {
  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
    registerAgentIpcHandlers(() => null)
  })

  it('projects persisted session state for the renderer', async () => {
    vi.mocked(agentSessionStateAppService.loadSessionState).mockResolvedValue({
      sessionId: 'session-1',
      status: 'completed',
      stepCount: 4,
      planMilestones: [{ id: 'm-1', title: 'Build app', status: 'completed' }],
    } as never)

    await expect(handlers.get('agent:get-plan-state')?.({}, 'session-1', '/repo')).resolves.toEqual({
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

    await handlers.get('agent:start-task')?.({}, payload)
    await handlers.get('agent:cancel-task')?.({}, identity)
    await handlers.get('agent:approval-response')?.({}, identity, true, [0])

    expect(taskQueueAppService.scheduleAgentTask).toHaveBeenCalledWith(payload, expect.any(Function))
    expect(taskQueueAppService.cancelTask).toHaveBeenCalledWith(identity)
    expect(respondToApproval).toHaveBeenCalledWith(identity, true, [0])
  })

  it('returns null when no persisted session state exists and forwards plan seeding', async () => {
    vi.mocked(agentSessionStateAppService.loadSessionState).mockResolvedValue(null)
    vi.mocked(agentSessionStateAppService.seedPlanMilestones).mockResolvedValue(true)
    const milestones = [{ id: 'm-1', title: 'Build app', status: 'pending' as const }]

    await expect(handlers.get('agent:get-plan-state')?.({}, 'missing', null)).resolves.toBeNull()
    await expect(handlers.get('agent:plan-seed')?.({}, 'session-1', '/repo', milestones, 'Build app')).resolves.toBe(true)
    expect(agentSessionStateAppService.seedPlanMilestones).toHaveBeenCalledWith('session-1', '/repo', milestones, 'Build app')
  })

  it('forwards workspace context and prior decisions to interview and planning', async () => {
    const settings = {} as any
    const decisions = [{ questionId: 'q1', questionText: 'Storage', selectedOption: 'Local' }]

    await handlers.get('agent:plan-interview')?.({}, 'Build app', 'model', settings, '/repo', decisions)
    const previousPlan = { id: 'plan-1' }
    await handlers.get('agent:plan-generate')?.({}, 'Build app', 'model', settings, previousPlan, '/repo', decisions)

    expect(agentInterviewAppService.conductInterview).toHaveBeenCalledWith('Build app', 'model', settings, '/repo', decisions)
    expect(planGenerationAppService.generatePlanText).toHaveBeenCalledWith(expect.objectContaining({
      workspacePath: '/repo',
      previousDecisions: decisions,
      previousPlan,
    }))
  })

  it('forwards the current question set when enriching answers', async () => {
    const answers = [{ questionId: 'q1', questionText: 'Storage?', selectedOption: 'SQLite', provenance: 'explicit' }]
    const questions = [{ id: 'q1', question: 'Storage?', rationale: 'Changes persistence.', options: ['SQLite', 'JSON'], recommendedIndex: 0 }]

    await handlers.get('agent:plan-enrich-prompt')?.({}, 'Build app', answers, questions)

    expect(agentInterviewAppService.enrichPromptWithAnswers).toHaveBeenCalledWith('Build app', answers, questions)
  })
})
