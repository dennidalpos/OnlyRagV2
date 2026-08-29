import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentToolExecutorService } from './agentToolExecutorService'
import { parseAgentToolCall } from '../domain/agent/toolParser'
import { toolExecutionResultSchema } from '../domain/agent/tools/toolExecutionContracts'
import { discoverProjectProfile } from '../infrastructure/filesystem/projectProfileDiscovery'
import { TaskRunner } from '../infrastructure/process/taskRunner'
import type { AppSettings } from '../../../shared/types'

describe('Wave 6 deterministic safety fixtures', () => {
  let workspacePath: string
  let executor: AgentToolExecutorService
  const settings = { allowTerminalExecution: true, allowFileModifications: true } as AppSettings

  beforeEach(() => {
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-wave6-fixtures-'))
    executor = new AgentToolExecutorService()
  })

  afterEach(() => {
    executor.disposeShellSessions()
    fs.rmSync(workspacePath, { recursive: true, force: true })
  })

  it('blocks a filesystem target outside the workspace deterministically', async () => {
    const result = await executor.executeTool(
      { tool: 'read_file', parameters: { filePath: '..\\outside.txt' } },
      workspacePath,
      settings,
    )

    expect(result.outputForHistory).toContain('Security Violation')
    expect(toolExecutionResultSchema.safeParse(result).success).toBe(true)
  })

  it('restores a changed file through the workspace rollback tool', async () => {
    const filePath = path.join(workspacePath, 'tracked.txt')
    fs.writeFileSync(filePath, 'before')

    const writeResult = await executor.executeTool(
      { tool: 'write_file', parameters: { filePath: 'tracked.txt', content: 'after' } },
      workspacePath,
      settings,
    )
    const rollbackResult = await executor.executeTool(
      { tool: 'rollback_workspace', parameters: {} },
      workspacePath,
      settings,
    )

    expect(writeResult.outputForHistory).toContain('Successfully wrote file')
    expect(rollbackResult.outputForHistory).toContain('Restored: 1 file(s).')
    expect(fs.readFileSync(filePath, 'utf8')).toBe('before')
  })

  it('returns a stable terminal contract for an unknown tool', async () => {
    const result = await executor.executeTool(
      { tool: 'wave6_unknown_tool' as never, parameters: {} },
      workspacePath,
      settings,
    )

    expect(toolExecutionResultSchema.safeParse(result).success).toBe(true)
    expect(result.terminalCode).toBe('MODEL_UNSUITABLE')
  })

  it('rejects truncated or malformed model output without throwing', () => {
    expect(() => parseAgentToolCall('{ "tool": "read_file", "parameters":')).not.toThrow()
    expect(parseAgentToolCall('{ "tool": "read_file", "parameters":')).toBeNull()
  })

  it('keeps a project without tests verifiable only through its declared build command', () => {
    fs.writeFileSync(path.join(workspacePath, 'package.json'), JSON.stringify({ scripts: { build: 'vite build' } }))

    const project = discoverProjectProfile(workspacePath).projects[0]

    expect(project.toolchain.testFrameworks).toEqual([])
    expect(project.verificationCommands).toEqual([
      expect.objectContaining({ kind: 'build', command: 'npm run build' }),
    ])
  })

  it('cancels an active task and removes its partial output deterministically', () => {
    const partialFile = path.join(workspacePath, 'partial-output.tmp')
    fs.writeFileSync(partialFile, 'partial')
    const destroy = vi.fn()
    const runner = new TaskRunner()

    runner.registerActiveTask('wave6-session', 'terminal_command', destroy, partialFile)
    const result = runner.cancelTask('wave6-session')

    expect(result).toEqual({ success: true, message: 'Task wave6-session cancelled successfully and residues cleaned.' })
    expect(destroy).toHaveBeenCalledOnce()
    expect(fs.existsSync(partialFile)).toBe(false)
  })
})
