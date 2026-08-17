import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { runAgentOrchestratorLoop, cancelActiveAgentTask } from './agentOrchestratorAppService'
import { ResilientModelDispatcher } from './resilientModelDispatcher'
import { ollamaAppService } from './ollamaAppService'
import { skillAppService } from './skillAppService'

vi.mock('./resilientModelDispatcher', () => ({
  ResilientModelDispatcher: {
    executeWithFallback: vi.fn(),
  },
}))

vi.mock('./ollamaAppService', () => ({
  ollamaAppService: {
    getInstalledModels: vi.fn().mockResolvedValue(['llama3.2:3b', 'qwen2.5-coder:7b', 'deepseek-r1:8b']),
    getModelCapabilities: vi.fn().mockResolvedValue({}),
  },
}))

vi.mock('./skillAppService', () => ({
  skillAppService: {
    getMatchedSkills: vi.fn().mockResolvedValue([]),
    getContextSkillsBlock: vi.fn().mockResolvedValue(''),
  },
}))

describe('AgentOrchestratorAppService Resilience & Loop Integration Tests', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-orchestrator-test-'))
    vi.clearAllMocks()
  })

  afterEach(() => {
    cancelActiveAgentTask()
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('should return error immediately if task prompt is empty', async () => {
    const res = await runAgentOrchestratorLoop(
      {
        userTask: '   ',
        agentMode: 'agent',
        workspacePath: tempDir,
      },
      null
    )

    expect(res.success).toBe(false)
    expect(res.error).toBe('Task prompt is required')
  })

  it('should execute finish tool call and complete session successfully', async () => {
    vi.mocked(ResilientModelDispatcher.executeWithFallback).mockResolvedValueOnce({
      output: '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "All tasks done perfectly." }\n}\n```',
      usedModel: 'llama3.2',
      isFallback: false,
    })

    const res = await runAgentOrchestratorLoop(
      {
        userTask: 'Create test project',
        agentMode: 'agent',
        workspacePath: tempDir,
      },
      null
    )

    expect(res.success).toBe(true)
    expect(res.summary).toBe('All tasks done perfectly.')
  })

  it('should intercept repetitive loop calls and inject intervention directive', async () => {
    // Model repeats the exact same failing command 3 times, then finishes
    const duplicateToolJson = '```json\n{\n  "tool": "run_command",\n  "parameters": { "command": "pytest failing_test.py" }\n}\n```'
    const finishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Pivoted and completed." }\n}\n```'

    vi.mocked(ResilientModelDispatcher.executeWithFallback)
      .mockResolvedValueOnce({ output: duplicateToolJson, usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: duplicateToolJson, usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: duplicateToolJson, usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: finishJson, usedModel: 'llama3.2', isFallback: false })

    const res = await runAgentOrchestratorLoop(
      {
        userTask: 'Debug test failures',
        agentMode: 'agent',
        workspacePath: tempDir,
      },
      null
    )

    expect(res.success).toBe(true)
    expect(res.summary).toBe('Pivoted and completed.')
    expect(ResilientModelDispatcher.executeWithFallback).toHaveBeenCalledTimes(4)
  })

  it('should execute in plan mode and complete with step proposal without mutating files', async () => {
    const proposedActionJson = '```json\n{\n  "tool": "write_file",\n  "parameters": { "filePath": "index.ts", "content": "console.log(1)" }\n}\n```'
    vi.mocked(ResilientModelDispatcher.executeWithFallback).mockResolvedValueOnce({
      output: proposedActionJson,
      usedModel: 'llama3.2',
      isFallback: false,
    })

    const res = await runAgentOrchestratorLoop(
      {
        userTask: 'Plan the architecture',
        agentMode: 'plan',
        workspacePath: tempDir,
      },
      null
    )

    expect(res.success).toBe(true)
    expect(res.summary).toContain('Proposed tool call: write_file')
    // Workspace must not have index.ts created in plan mode
    expect(fs.existsSync(path.join(tempDir, 'index.ts'))).toBe(false)
  })

  it('should persist a plan initialized during a PLAN-mode step before the step returns (regression: plan was lost because it was only ever persisted at the top of the NEXT step)', async () => {
    const planWithChecklistJson =
      '- [ ] Design database schema\n- [ ] Implement API endpoints\n\n' +
      '```json\n{\n  "tool": "write_file",\n  "parameters": { "filePath": "index.ts", "content": "console.log(1)" }\n}\n```'
    vi.mocked(ResilientModelDispatcher.executeWithFallback).mockResolvedValueOnce({
      output: planWithChecklistJson,
      usedModel: 'llama3.2',
      isFallback: false,
    })

    const sessionId = 'test-plan-persist-session'
    const res = await runAgentOrchestratorLoop(
      {
        userTask: 'Plan the architecture',
        agentMode: 'plan',
        workspacePath: tempDir,
      },
      null,
      sessionId
    )

    expect(res.success).toBe(true)

    const statePath = path.join(tempDir, '.onlyrag', `.agent_state_${sessionId}.json`)
    expect(fs.existsSync(statePath)).toBe(true)
    const savedState = JSON.parse(fs.readFileSync(statePath, 'utf-8'))
    expect(savedState.planMilestones.length).toBe(2)
    expect(savedState.planMilestones[0].title).toContain('Design database schema')
  })

  it('should hot-swap from plan to agent mode smoothly on consecutive turns', async () => {
    // Turn 1: Plan Mode
    const planJson = '```json\n{\n  "tool": "write_file",\n  "parameters": { "filePath": "app.ts", "content": "export const a = 1;" }\n}\n```'
    vi.mocked(ResilientModelDispatcher.executeWithFallback).mockResolvedValueOnce({
      output: planJson,
      usedModel: 'llama3.2',
      isFallback: false,
    })

    const turn1Res = await runAgentOrchestratorLoop(
      {
        userTask: 'Step 1: Plan architecture',
        agentMode: 'plan',
        workspacePath: tempDir,
      },
      null
    )
    expect(turn1Res.success).toBe(true)
    expect(turn1Res.summary).toContain('Proposed tool call')

    // Turn 2: Hot-swapped to Agent Mode (executes and finishes)
    const agentFinishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Code executed and verified." }\n}\n```'
    vi.mocked(ResilientModelDispatcher.executeWithFallback).mockResolvedValueOnce({
      output: agentFinishJson,
      usedModel: 'llama3.2',
      isFallback: false,
    })

    const turn2Res = await runAgentOrchestratorLoop(
      {
        userTask: 'Step 2: Execute plan',
        agentMode: 'agent',
        workspacePath: tempDir,
      },
      null
    )
    expect(turn2Res.success).toBe(true)
    expect(turn2Res.summary).toBe('Code executed and verified.')
  })

  it('should submit mutating tool calls for human approval in ASK mode instead of FSM-denying them (regression: the FSM permission gate previously ran before the approval check, silently breaking the ASK-mode approval flow promised by promptPresets.ts and the PendingApprovalModal UI)', async () => {
    const writeFileJson = '```json\n{\n  "tool": "write_file",\n  "parameters": { "filePath": "index.ts", "content": "console.log(1)" }\n}\n```'
    vi.mocked(ResilientModelDispatcher.executeWithFallback).mockResolvedValueOnce({
      output: writeFileJson,
      usedModel: 'llama3.2',
      isFallback: false,
    })

    const res = await runAgentOrchestratorLoop(
      {
        userTask: 'Update the entrypoint file',
        agentMode: 'ask',
        workspacePath: tempDir,
      },
      null
    )

    expect(res.success).toBe(true)
    expect(res.summary).toBe('Awaiting approval for write_file')
    expect(res.summary).not.toContain('FSM PERMISSION DENIED')
    // Must not execute directly: the file is only written after the user approves via the frontend modal
    expect(fs.existsSync(path.join(tempDir, 'index.ts'))).toBe(false)
  })

  it('should still allow finish (a non-mutating tool) in ASK mode without triggering the approval flow', async () => {
    const finishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Inspection complete." }\n}\n```'
    vi.mocked(ResilientModelDispatcher.executeWithFallback).mockResolvedValueOnce({
      output: finishJson,
      usedModel: 'llama3.2',
      isFallback: false,
    })

    const res = await runAgentOrchestratorLoop(
      {
        userTask: 'Inspect the codebase',
        agentMode: 'ask',
        workspacePath: tempDir,
      },
      null
    )

    expect(res.success).toBe(true)
    expect(res.summary).toBe('Inspection complete.')
  })

  it('should always submit git_commit for human approval, even in AGENT mode (unlike other mutating tools which execute autonomously there)', async () => {
    const commitJson = '```json\n{\n  "tool": "git_commit",\n  "parameters": { "commitMessage": "Add feature X" }\n}\n```'
    vi.mocked(ResilientModelDispatcher.executeWithFallback).mockResolvedValueOnce({
      output: commitJson,
      usedModel: 'llama3.2',
      isFallback: false,
    })

    const res = await runAgentOrchestratorLoop(
      {
        userTask: 'Commit the changes',
        agentMode: 'agent',
        workspacePath: tempDir,
      },
      null
    )

    expect(res.success).toBe(true)
    expect(res.summary).toBe('Awaiting approval for git_commit')
    expect(res.summary).not.toContain('FSM PERMISSION DENIED')
  })
})
