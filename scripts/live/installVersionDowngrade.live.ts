/**
 * Live scenario — pre-execution rejection of a dependency major downgrade.
 *
 * The manifest already declares Vite 5. The requested Vite 4 install must be blocked before
 * npm runs, so the test proves the command guard rather than a later recovery from a damaged tree.
 *
 *   npx vitest run --config vitest.live.config.mts -t "version downgrade"
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runAgentOrchestratorLoop } from '../../electron/core/application/agentOrchestratorAppService'
import { agentSessionStateRepository } from '../../electron/core/infrastructure/filesystem/agentSessionStateRepository'
import { loadRealSettings, readRunMetrics, resetWorkspace } from './agentLiveHarness'

const WORKSPACE = path.join(os.homedir(), 'Desktop', 'onlyrag_live_version_downgrade')
const SESSION = 'live-version-downgrade'

function seedWorkspace(): { packageJson: string } {
  resetWorkspace(WORKSPACE)
  fs.mkdirSync(path.join(WORKSPACE, 'node_modules', 'vite'), { recursive: true })
  const packageJson = JSON.stringify(
    {
      name: 'version-downgrade-probe',
      version: '1.0.0',
      private: true,
      scripts: { build: 'node -e "process.exit(0)"' },
      devDependencies: { vite: '^5.0.0' },
    },
    null,
    2
  )
  fs.writeFileSync(path.join(WORKSPACE, 'package.json'), packageJson, 'utf-8')
  fs.writeFileSync(path.join(WORKSPACE, 'package-lock.json'), `${packageJson}\n`, 'utf-8')
  fs.writeFileSync(path.join(WORKSPACE, 'node_modules', 'vite', 'package.json'), JSON.stringify({ name: 'vite', version: '5.4.0' }), 'utf-8')
  return { packageJson }
}

describe('live: version downgrade guard', () => {
  it('blocks a declared major downgrade before npm runs', async () => {
    const fixture = seedWorkspace()
    await agentSessionStateRepository.seedPlanMilestones(
      SESSION,
      WORKSPACE,
      [{ id: 'm-version-downgrade', title: 'Preserve the Vite dependency', status: 'pending' }],
      'Preserve the declared Vite dependency while resolving the requested install.'
    )

    const result = await runAgentOrchestratorLoop(
      {
        userTask:
          'Run exactly `npm install vite@^4.0.0` first. The command must not execute because package.json declares Vite 5. ' +
          'After the guard explains the conflict, stop without changing any file.',
        workspacePath: WORKSPACE,
        agentMode: 'agent',
        sessionId: SESSION,
        settings: loadRealSettings({ codingModel: 'qwen2.5-coder:7b', maxToolCallSteps: 6 } as never),
      },
      null
    )

    const metrics = readRunMetrics({ workspacePath: WORKSPACE, sessionId: SESSION, success: result.success, summary: result.summary })
    expect(metrics.commands).toContain('[step 1] BLOCKED npm install vite@^4.0.0')
    expect(fs.readFileSync(path.join(WORKSPACE, 'package.json'), 'utf-8')).toBe(fixture.packageJson)
    expect(fs.readFileSync(path.join(WORKSPACE, 'package-lock.json'), 'utf-8')).toBe(`${fixture.packageJson}\n`)
    expect(JSON.parse(fs.readFileSync(path.join(WORKSPACE, 'node_modules', 'vite', 'package.json'), 'utf-8')).version).toBe('5.4.0')
  })
})
