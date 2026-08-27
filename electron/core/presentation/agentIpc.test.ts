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

vi.mock('../application/taskQueueAppService', () => ({ taskQueueAppService: {} }))
vi.mock('../domain/agent/toolParser', () => ({ parseAgentToolCall: vi.fn() }))
vi.mock('../application/sidecarSlmBridgeService', () => ({ sidecarSlmBridgeService: {} }))
vi.mock('../application/planGenerationAppService', () => ({ planGenerationAppService: {} }))
vi.mock('../application/aiDebugBundleService', () => ({ aiDebugBundleService: {} }))
vi.mock('../application/agentSessionStateAppService', () => ({
  agentSessionStateAppService: {
    loadSessionState: vi.fn(),
    seedPlanMilestones: vi.fn(),
  },
}))

import { agentSessionStateAppService } from '../application/agentSessionStateAppService'
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

  it('returns null when no persisted session state exists and forwards plan seeding', async () => {
    vi.mocked(agentSessionStateAppService.loadSessionState).mockResolvedValue(null)
    vi.mocked(agentSessionStateAppService.seedPlanMilestones).mockResolvedValue(true)
    const milestones = [{ id: 'm-1', title: 'Build app', status: 'pending' as const }]

    await expect(handlers.get('agent:get-plan-state')?.({}, 'missing', null)).resolves.toBeNull()
    await expect(handlers.get('agent:plan-seed')?.({}, 'session-1', '/repo', milestones, 'Build app')).resolves.toBe(true)
    expect(agentSessionStateAppService.seedPlanMilestones).toHaveBeenCalledWith('session-1', '/repo', milestones, 'Build app')
  })
})
