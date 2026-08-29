import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentToolExecutorService } from './agentToolExecutorService'
import type { AppSettings } from '../../../shared/types'
import { toolExecutionResultSchema } from '../domain/agent/tools/toolExecutionContracts'

describe('AgentToolExecutorService dispatcher contract', () => {
  let workspacePath: string
  let executor: AgentToolExecutorService
  const settings = { allowTerminalExecution: true, allowFileModifications: true } as AppSettings

  beforeEach(() => {
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-dispatcher-contract-'))
    executor = new AgentToolExecutorService()
  })

  afterEach(() => {
    executor.disposeShellSessions()
    fs.rmSync(workspacePath, { recursive: true, force: true })
  })

  it('routes representative filesystem, diagnostic, and git tools through one result contract', async () => {
    const calls = [
      { tool: 'list_dir' as const, parameters: { dirPath: '.' } },
      { tool: 'ask' as const, parameters: { question: 'Need clarification' } },
      { tool: 'git_status' as const, parameters: {} },
    ]

    for (const call of calls) {
      const result = await executor.executeTool(call, workspacePath, settings)
      expect(toolExecutionResultSchema.safeParse(result).success, call.tool).toBe(true)
      expect(result.logMessage.length, call.tool).toBeGreaterThan(0)
    }
  })

  it('returns a stable unsupported-tool result instead of throwing', async () => {
    const result = await executor.executeTool(
      { tool: 'unsupported_tool' as never, parameters: {} },
      workspacePath,
      settings,
    )

    expect(toolExecutionResultSchema.safeParse(result).success).toBe(true)
    expect(result.outputForHistory).toContain('Unrecognized or unsupported tool')
    expect(result.terminalCode).toBe('MODEL_UNSUITABLE')
  })
})
