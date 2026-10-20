import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentTaskRequest } from '../../../shared/types'

vi.mock('./agentOrchestratorAppService', () => ({ runAgentOrchestratorLoop: vi.fn(), cancelActiveAgentTask: vi.fn(async () => {}) }))
import { runAgentOrchestratorLoop } from './agentOrchestratorAppService'
import { TaskQueueAppService } from './taskQueueAppService'
import { AgentTaskRecoveryRepository } from '../infrastructure/filesystem/agentTaskRecoveryRepository'
import { agentSessionStateRepository } from '../infrastructure/filesystem/agentSessionStateRepository'

describe('durable accepted agent tasks', () => {
  let root: string
  let file: string
  let repository: AgentTaskRecoveryRepository
  const events = { isAvailable: () => true, send: vi.fn() }
  const request = (id: string): AgentTaskRequest => ({
    identity: { runId: id, conversationId: `conversation-${id}`, workspaceId: 'isolated', planRevisionId: 'plan-v1' },
    userTask: `Inspect ${id}`,
    agentMode: 'ask',
    workspacePath: root,
  })
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-recovery-test-'))
    file = path.join(root, 'profile', 'agent-task-recovery.json')
    repository = new AgentTaskRecoveryRepository(() => file)
    vi.mocked(runAgentOrchestratorLoop).mockReset().mockResolvedValue({ success: true, summary: 'done' })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('retains concurrent admissions across a fresh repository and refuses duplicate and terminal identities', async () => {
    await Promise.all([repository.accept(request('one')), repository.accept(request('two'))])
    const restarted = new AgentTaskRecoveryRepository(() => file)
    expect(restarted.list().map((task) => task.identity.runId)).toEqual(['one', 'two'])
    expect(restarted.load(request('one').identity)).toEqual(request('one'))
    await expect(restarted.accept(request('one'))).rejects.toThrow('already accepted')
    expect(() => restarted.load({ ...request('one').identity, planRevisionId: 'foreign' })).toThrow('No interrupted task')
    await restarted.finish(request('one').identity)
    expect(restarted.list().map((task) => task.identity.runId)).toEqual(['two'])
    expect(fs.readFileSync(file, 'utf8')).not.toContain('Inspect one')
    expect(() => restarted.load(request('one').identity)).toThrow('No interrupted task')
  })

  it('preserves invalid recovery bytes and refuses new work instead of overwriting them', async () => {
    await repository.accept(request('one'))
    fs.writeFileSync(file, '{invalid')
    await expect(repository.accept(request('two'))).rejects.toThrow()
    expect(() => repository.list()).toThrow()
    expect(fs.readFileSync(file, 'utf8')).toBe('{invalid')
  })

  it('does not acknowledge or execute a task when storage refuses admission', async () => {
    fs.writeFileSync(path.dirname(file), 'blocking file')
    const service = new TaskQueueAppService(() => root, repository)
    const result = await service.scheduleAgentTask(request('one'), events)
    expect(result.success).toBe(false)
    expect(runAgentOrchestratorLoop).not.toHaveBeenCalled()
    expect(service.getQueueStatus()).toMatchObject({ queuedCount: 0, runningCount: 0 })
    expect(fs.readFileSync(path.dirname(file), 'utf8')).toBe('blocking file')
  })

  it('starts nothing on restart and resumes each pending task only once on explicit request', async () => {
    await repository.accept(request('one'))
    await repository.accept(request('two'))
    const service = new TaskQueueAppService(() => root, new AgentTaskRecoveryRepository(() => file))
    expect(service.listRecoverableTasks()).toHaveLength(2)
    expect(runAgentOrchestratorLoop).not.toHaveBeenCalled()
    const [first, duplicate] = await Promise.all([service.resumeTask(request('one').identity, events), service.resumeTask(request('one').identity, events)])
    expect([first.success, duplicate.success].sort()).toEqual([false, true])
    await vi.waitFor(() => expect(service.getQueueStatus().runningCount).toBe(0))
    expect(runAgentOrchestratorLoop).toHaveBeenCalledTimes(1)
    expect((await service.resumeTask(request('one').identity, events)).success).toBe(false)
    expect(service.listRecoverableTasks().map((task) => task.identity.runId)).toEqual(['two'])
  })

  it('refuses replay after the terminal checkpoint even if the process died before retiring the queue receipt', async () => {
    await repository.accept(request('one'))
    vi.spyOn(agentSessionStateRepository, 'loadSessionState').mockResolvedValue({
      runIdentity: request('one').identity,
      completionStatus: 'verified',
      status: 'COMPLETED',
    } as never)
    const service = new TaskQueueAppService(() => root, repository)
    expect((await service.resumeTask(request('one').identity, events)).success).toBe(false)
    expect(runAgentOrchestratorLoop).not.toHaveBeenCalled()
    expect(repository.list()).toEqual([])
  })

  it('refuses an unknown in-flight action without discarding its request or replaying its effects', async () => {
    await repository.accept(request('one'))
    vi.spyOn(agentSessionStateRepository, 'loadSessionState').mockResolvedValue({
      runIdentity: request('one').identity,
      status: 'IN_PROGRESS',
      executionPhase: 'apply_action',
    } as never)
    const service = new TaskQueueAppService(() => root, repository)
    expect((await service.resumeTask(request('one').identity, events)).success).toBe(false)
    expect(runAgentOrchestratorLoop).not.toHaveBeenCalled()
    expect(repository.list()).toHaveLength(1)
  })

  it('preserves conversation recovery order and refuses a fresh identity that would overwrite retained execution state', async () => {
    const first = request('one')
    const later = { ...request('two'), identity: { ...request('two').identity, conversationId: first.identity.conversationId } }
    await repository.accept(first)
    await repository.accept(later)
    const service = new TaskQueueAppService(() => root, repository)
    const fresh = { ...request('fresh'), identity: { ...request('fresh').identity, conversationId: first.identity.conversationId } }
    expect((await service.scheduleAgentTask(fresh, events)).success).toBe(false)
    expect((await service.resumeTask(later.identity, events)).success).toBe(false)
    expect(runAgentOrchestratorLoop).not.toHaveBeenCalled()
    expect((await service.resumeTask(first.identity, events)).success).toBe(true)
    await vi.waitFor(() => expect(service.getQueueStatus().runningCount).toBe(0))
    expect((await service.resumeTask(later.identity, events)).success).toBe(true)
    await vi.waitFor(() => expect(service.getQueueStatus().runningCount).toBe(0))
    expect(vi.mocked(runAgentOrchestratorLoop).mock.calls.map((call) => call[2])).toEqual(['one', 'two'])
  })
})
