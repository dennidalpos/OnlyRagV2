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
    on: vi.fn((channel: string, handler: (...args: any[]) => any) => {
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
import { sanitizeAppSettings } from '../domain/settings/appSettingsDomain'

const trustedContents = { mainFrame: {} }
const trustedEvent = { sender: trustedContents, senderFrame: trustedContents.mainFrame }
const runIdentity = { runId: 'run-1', conversationId: 'conversation-1', planRevisionId: 'plan-1:v2', workspaceId: 'workspace-1' }

describe('agent IPC session-state facade', () => {
  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
    setTrustedIpcWindowProvider(() => ({ webContents: trustedContents }) as never)
    registerAgentIpcHandlers({ isAvailable: () => false, send: () => {} })
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

    expect(taskQueueAppService.scheduleAgentTask).toHaveBeenCalledWith(
      { ...payload, activeFile: null },
      expect.objectContaining({ send: expect.any(Function) }),
    )
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

  it('accepts exactly one versioned active-file context and rejects legacy contextFiles', () => {
    const payload = parseAgentTaskPayload({
      identity: runIdentity,
      userTask: 'Inspect the editor file',
      agentMode: 'ask',
      activeFile: {
        name: 'app.ts',
        path: 'D:/repo/app.ts',
        content: 'export const app = true',
        versionHash: 'a'.repeat(64),
      },
    })

    expect(payload.activeFile).toMatchObject({ path: 'D:/repo/app.ts', versionHash: 'a'.repeat(64) })
    expect(() => parseAgentTaskPayload({ identity: runIdentity, userTask: 'Inspect', contextFiles: [{ path: 'ignored.ts' }] })).toThrow(
      'Invalid agent task payload',
    )
    expect(() =>
      parseAgentTaskPayload({ identity: runIdentity, userTask: 'Inspect', agentMode: 'ask', activeFile: { path: 'app.ts', content: '', versionHash: 'bad' } }),
    ).toThrow('Invalid agent task payload: activeFile')
  })

  it('defaults to Guided and rejects removed execution modes', () => {
    expect(parseAgentTaskPayload({ identity: runIdentity, userTask: 'Inspect' }).agentMode).toBe('guided')
    expect(() => parseAgentTaskPayload({ identity: runIdentity, userTask: 'Inspect', agentMode: 'agent' })).toThrow()
    expect(() => parseAgentTaskPayload({ identity: runIdentity, userTask: 'Inspect', agentMode: 'plan' })).toThrow()
  })

  it('accepts the explicit backend context-compaction flag', () => {
    expect(
      parseAgentTaskPayload({ identity: runIdentity, userTask: 'Inspect', agentMode: 'guided', forceContextCompaction: true }).forceContextCompaction,
    ).toBe(true)
  })

  it('accepts the complete renderer request and normalizes its settings snapshot', () => {
    const payload = parseAgentTaskPayload({
      identity: runIdentity,
      sessionId: runIdentity.conversationId,
      userTask: 'Inspect',
      initialUserTask: 'Inspect',
      agentMode: 'auto',
      workspacePath: 'D:/repo',
      isStandaloneMode: false,
      activeModel: 'qwen2.5-coder:7b',
      activeFile: null,
      pinnedFiles: [{ name: 'a.ts', path: 'D:/repo/a.ts', content: 'x' }],
      attachedDocs: [{ id: 'doc-1', filename: 'spec.pdf', extractedMarkdown: '# Spec' }],
      capabilityProfile: { allowFileModifications: true, allowTerminalExecution: false, capabilityPolicyMode: 'local-only', maxToolCallSteps: 25 },
      forceContextCompaction: false,
      settings: { defaultModel: ' m ', ollamaHost: 'http://127.0.0.1:11434', ocrEngine: 'bogus', unknownSetting: true },
    })

    expect(payload.pinnedFiles).toHaveLength(1)
    expect(payload.settings).toMatchObject({ defaultModel: 'm', ocrEngine: 'native_cuda' })
    expect(payload.settings).not.toHaveProperty('unknownSetting')
  })

  it.each([
    ['unknown top-level field', { extra: true }],
    ['Main-only sourceWorkspacePath', { sourceWorkspacePath: 'D:/elsewhere' }],
    ['missing identity', { identity: undefined }],
    ['malformed identity', { identity: { runId: 'run-1' } }],
    ['identity with extra keys', { identity: { ...runIdentity, admin: true } }],
    [
      'unknown capability policy',
      { capabilityProfile: { allowFileModifications: true, allowTerminalExecution: true, capabilityPolicyMode: 'anything', maxToolCallSteps: 5 } },
    ],
    [
      'negative step budget',
      { capabilityProfile: { allowFileModifications: true, allowTerminalExecution: true, capabilityPolicyMode: 'local-only', maxToolCallSteps: -1 } },
    ],
    ['pinnedFiles not an array', { pinnedFiles: { name: 'a' } }],
    ['pinned file with extra keys', { pinnedFiles: [{ name: 'a', path: 'D:/a', content: '', mode: 'rw' }] }],
    ['attached doc without markdown', { attachedDocs: [{ id: 'doc-1', filename: 'a.pdf' }] }],
    ['non-object settings', { settings: 'all' }],
  ])('rejects %s at the IPC boundary before dispatch', (_label, override) => {
    const handler = handlers.get('agent:start-task')!
    const payload = { identity: runIdentity, userTask: 'Inspect', agentMode: 'ask', ...override }
    expect(() => handler(trustedEvent, payload)).toThrow('Invalid IPC payload for agent:start-task')
    expect(() => parseAgentTaskPayload(payload)).toThrow('Invalid agent task payload')
    expect(taskQueueAppService.scheduleAgentTask).not.toHaveBeenCalled()
  })

  it('strips unknown milestone keys before seeding and rejects invalid statuses', async () => {
    vi.mocked(agentSessionStateAppService.seedPlanMilestones).mockResolvedValue(true)
    const handler = handlers.get('agent:plan-seed')!

    await handler(trustedEvent, 'session-1', '/repo', [{ id: 'm-1', title: 'Build', status: 'pending', injected: 'x' }], 'Build', 'plan-1:v1')

    expect(agentSessionStateAppService.seedPlanMilestones).toHaveBeenCalledWith(
      'session-1',
      '/repo',
      [{ id: 'm-1', title: 'Build', status: 'pending' }],
      'Build',
      'plan-1:v1',
    )
    expect(() => handler(trustedEvent, 'session-1', '/repo', [{ id: 'm-1', title: 'Build', status: 'done' }])).toThrow('Invalid IPC payload')
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

    expect(agentInterviewAppService.conductInterview).toHaveBeenCalledWith('Build app', 'model', sanitizeAppSettings(settings), '/repo', decisions)
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
