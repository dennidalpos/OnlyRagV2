import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { agentSessionStateRepository, SavedAgentSessionState } from './agentSessionStateRepository'

describe('AgentSessionStateRepository Unit Tests', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-session-test-'))
  })

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('should save, load, and clear session state correctly', async () => {
    const mockState: SavedAgentSessionState = {
      sessionId: 'session-test-123',
      workspacePath: tempDir,
      agentMode: 'agent',
      stepCount: 5,
      maxSteps: 50,
      episodes: [
        { step: 1, tool: 'read_file', status: 'SUCCESS', summary: 'Read index.html' },
        { step: 2, tool: 'replace_file_content', status: 'FAILURE', summary: 'Target content mismatch' },
      ],
      recentFullLogs: [
        { step: 2, tool: 'replace_file_content', output: 'Target content mismatch line 15' },
      ],
      planMilestones: [
        { id: 'm1', title: 'Setup structure', status: 'verified' },
      ],
      userTask: 'Fix replace file content bug',
      updatedAt: new Date().toISOString(),
    }

    const saved = await agentSessionStateRepository.saveSessionState(mockState)
    expect(saved).toBe(true)

    const loaded = await agentSessionStateRepository.loadSessionState('session-test-123', tempDir)
    expect(loaded).not.toBeNull()
    expect(loaded?.sessionId).toBe('session-test-123')
    expect(loaded?.stepCount).toBe(5)
    expect(loaded?.episodes.length).toBe(2)
    expect(loaded?.episodes[1].status).toBe('FAILURE')
    expect(loaded?.recentFullLogs[0].output).toContain('Target content mismatch')

    const cleared = await agentSessionStateRepository.clearSessionState('session-test-123', tempDir)
    expect(cleared).toBe(true)

    const loadedAfterClear = await agentSessionStateRepository.loadSessionState('session-test-123', tempDir)
    expect(loadedAfterClear).toBeNull()
  })
})
