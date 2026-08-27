/** Live scenario — the terminal budget exit performs the final project verification. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runAgentOrchestratorLoop } from '../../electron/core/application/agentOrchestratorAppService'
import { agentSessionStateRepository } from '../../electron/core/infrastructure/filesystem/agentSessionStateRepository'
import { loadRealSettings, readRunMetrics, resetWorkspace } from './agentLiveHarness'

const WORKSPACE = path.join(os.homedir(), 'Desktop', 'onlyrag_live_budget_exhaustion')
const SESSION = 'live-budget-exhaustion'

describe('live: budget exhaustion verification', () => {
  it('runs the project check after delivery when the model never calls finish', async () => {
    resetWorkspace(WORKSPACE)
    fs.mkdirSync(path.join(WORKSPACE, 'src'), { recursive: true })
    fs.writeFileSync(path.join(WORKSPACE, 'src', 'Proven.ts'), 'export const proven = true\n', 'utf-8')
    fs.writeFileSync(
      path.join(WORKSPACE, 'package.json'),
      JSON.stringify(
        {
          name: 'budget-exhaustion-probe',
          version: '1.0.0',
          private: true,
          scripts: { build: 'node -e "process.exit(0)"' },
        },
        null,
        2
      ),
      'utf-8'
    )
    const milestones = [
      { id: 'm-proven', title: 'Preserve src/Proven.ts', status: 'in_progress' as const },
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `m-budget-${index + 1}`,
        title: `Create src/Work${index + 1}.ts`,
        status: 'pending' as const,
      })),
    ]
    await agentSessionStateRepository.seedPlanMilestones(
      SESSION,
      WORKSPACE,
      milestones,
      'Create the planned files one at a time. Do not call finish or run commands; keep working until the step budget ends.'
    )

    const result = await runAgentOrchestratorLoop(
      {
        userTask:
          'Create the planned files one at a time with valid exported constants. Do not call finish and do not run commands: use file tools only until the step budget is exhausted.',
        workspacePath: WORKSPACE,
        agentMode: 'agent',
        sessionId: SESSION,
        settings: loadRealSettings({ codingModel: 'qwen2.5-coder:7b', maxToolCallSteps: 10 } as never),
      },
      null
    )

    const metrics = readRunMetrics({ workspacePath: WORKSPACE, sessionId: SESSION, success: result.success, summary: result.summary })
    expect(result.success).toBe(true)
    expect(metrics.hitStepCeiling).toBe(true)
    expect(result.summary).toContain('Verifica finale "npm run build" superata')
    expect(metrics.verified).toBeGreaterThan(0)
  })
})
