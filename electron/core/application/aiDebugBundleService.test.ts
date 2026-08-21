import { describe, it, expect, vi, beforeEach } from 'vitest'
import { aiDebugBundleService } from './aiDebugBundleService'
import { agentSessionStateRepository } from '../infrastructure/filesystem/agentSessionStateRepository'
import { gitCliRepository } from '../infrastructure/process/gitCliRepository'
import { devToolProbeRepository } from '../infrastructure/process/devToolProbeRepository'

vi.mock('../infrastructure/filesystem/agentSessionStateRepository')
vi.mock('../infrastructure/process/gitCliRepository')
vi.mock('../infrastructure/process/devToolProbeRepository')

describe('AiDebugBundleService Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should generate a comprehensive AI-optimized markdown debug bundle', async () => {
    vi.mocked(agentSessionStateRepository.loadSessionState).mockResolvedValue({
      sessionId: 'session-123',
      workspacePath: 'D:/TestWorkspace',
      agentMode: 'agent',
      stepCount: 2,
      maxSteps: 50,
      episodes: [
        {
          step: 1,
          tool: 'read_file',
          target: 'src/app.ts',
          status: 'SUCCESS',
          summary: 'Read 20 lines of code',
        },
        {
          step: 2,
          tool: 'replace_file_content',
          target: 'src/app.ts',
          status: 'FAILURE',
          summary: 'Target string not found',
        },
      ],
      recentFullLogs: [
        {
          step: 2,
          tool: 'replace_file_content',
          output: 'Error: TargetContent was not found in src/app.ts',
          isFailure: true,
        },
      ],
      planMilestones: [
        {
          id: 'm1',
          title: 'Refactor app.ts',
          status: 'in_progress',
        },
      ],
      userTask: 'Fix typo in app.ts',
      updatedAt: new Date().toISOString(),
    } as any)

    vi.mocked(gitCliRepository.run).mockImplementation((_cwd, args) => {
      if (args.includes('status')) return ' M src/app.ts'
      if (args.includes('diff')) return '+const app = true;\n-const app = false;'
      return ''
    })

    vi.mocked(devToolProbeRepository.probeVersion).mockReturnValue('v20.18.0')

    const bundle = await aiDebugBundleService.generateDebugBundle({
      sessionId: 'session-123',
      workspacePath: 'D:/TestWorkspace',
      activeModelName: 'qwen2.5-coder:7b',
      activeSkills: ['test-skill'],
    })

    expect(bundle).toContain('# 🐞 ONLYRAG V2 — CODING AGENT DEBUG BUNDLE')
    expect(bundle).toContain('Prompt for AI Assistant:')
    expect(bundle).toContain('session-123')
    expect(bundle).toContain('Fix typo in app.ts')
    expect(bundle).toContain('| 1 | `read_file` | `src/app.ts` | ✅ SUCCESS |')
    expect(bundle).toContain('| 2 | `replace_file_content` | `src/app.ts` | ❌ FAILURE |')
    expect(bundle).toContain('TargetContent was not found in src/app.ts')
    expect(bundle).toContain('```diff\n+const app = true;\n-const app = false;\n```')
    expect(bundle).toContain('Refactor app.ts')
  })

  it('should handle sessions with no git or state gracefully', async () => {
    vi.mocked(agentSessionStateRepository.loadSessionState).mockResolvedValue(null)
    vi.mocked(gitCliRepository.run).mockImplementation(() => {
      throw new Error('Not a git repo')
    })
    vi.mocked(devToolProbeRepository.probeVersion).mockReturnValue(null)

    const bundle = await aiDebugBundleService.generateDebugBundle({
      sessionId: 'empty-session',
    })

    expect(bundle).toContain('Nessun passaggio registrato')
    expect(bundle).toContain('Nessun errore fatale riscontrato')
    expect(bundle).toContain('No Git repository detected')
  })
})
