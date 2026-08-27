/**
 * Live scenario — recovery after an install of an unavailable imported package fails.
 *
 * The first install is intentionally a bare package name, so registry version preflight does not
 * intercept it. Once npm reports the failure, the arbiter must order one `write_file` against the
 * importer instead of repeating the install or asking the model to edit several files.
 *
 *   npx vitest run --config vitest.live.config.mts -t "uninstallable dependency"
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runAgentOrchestratorLoop } from '../../electron/core/application/agentOrchestratorAppService'
import { agentSessionStateRepository } from '../../electron/core/infrastructure/filesystem/agentSessionStateRepository'
import { loadRealSettings, readRunMetrics, resetWorkspace } from './agentLiveHarness'

const WORKSPACE = path.join(os.homedir(), 'Desktop', 'onlyrag_live_uninstallable_dependency')
const SESSION = 'live-uninstallable-dependency'
const PACKAGE_NAME = '@onlyrag/not-published-probe'

function seedWorkspace(): { packageJson: string; source: string } {
  resetWorkspace(WORKSPACE)
  fs.mkdirSync(path.join(WORKSPACE, 'src'), { recursive: true })
  const packageJson = JSON.stringify(
    {
      name: 'uninstallable-dependency-probe',
      version: '1.0.0',
      private: true,
      scripts: { build: 'node -e "process.exit(0)"' },
    },
    null,
    2
  )
  const source = `import { missingWidget } from '${PACKAGE_NAME}'\nexport const dashboard = missingWidget\n`
  fs.writeFileSync(path.join(WORKSPACE, 'package.json'), packageJson, 'utf-8')
  fs.writeFileSync(path.join(WORKSPACE, 'src', 'Dashboard.ts'), source, 'utf-8')
  return { packageJson, source }
}

describe('live: uninstallable dependency recovery', () => {
  it('rewrites the importer after the failed install instead of repeating it', async () => {
    const emittedLogs: string[] = []
    const liveWindow = {
      isDestroyed: () => false,
      webContents: { send: (_channel: string, payload: { message?: string }) => emittedLogs.push(payload.message || '') },
    } as never
    const fixture = seedWorkspace()
    await agentSessionStateRepository.seedPlanMilestones(
      SESSION,
      WORKSPACE,
      [{ id: 'm-uninstallable', title: 'Fix src/Dashboard.ts', status: 'pending' }],
      'Remove the unavailable package import from src/Dashboard.ts.'
    )

    const result = await runAgentOrchestratorLoop(
      {
        userTask:
          `Run exactly \`npm install ${PACKAGE_NAME}\` first. It must fail because the package is unavailable. ` +
          'After the failure, remove that import from src/Dashboard.ts with one write_file call. ' +
          'Do not run another install and do not edit package.json. Stop after the file is fixed.',
        workspacePath: WORKSPACE,
        agentMode: 'agent',
        sessionId: SESSION,
        settings: loadRealSettings({ codingModel: 'qwen2.5-coder:7b', maxToolCallSteps: 10 } as never),
      },
      liveWindow
    )

    const metrics = readRunMetrics({ workspacePath: WORKSPACE, sessionId: SESSION, success: result.success, summary: result.summary })
    const source = fs.readFileSync(path.join(WORKSPACE, 'src', 'Dashboard.ts'), 'utf-8')
    expect(metrics.commands.some((command) => command.includes(`npm install ${PACKAGE_NAME}`))).toBe(true)
    expect(metrics.commands.filter((command) => command.includes(`npm install ${PACKAGE_NAME}`))).toHaveLength(1)
    expect(result.success).toBe(true)
    expect(source).not.toMatch(new RegExp(`from\\s+['"]${PACKAGE_NAME.replace('/', '\\/')}['"]`))
    expect(source).not.toContain('missingWidget')
    expect(fs.readFileSync(path.join(WORKSPACE, 'package.json'), 'utf-8')).toBe(fixture.packageJson)
    expect(source).not.toBe(fixture.source)
    expect(emittedLogs.some((message) => message.includes('Context policy [dependencies_uninstallable]'))).toBe(true)
    expect(emittedLogs.some((message) => message.includes('omitting repo map'))).toBe(true)
  })
})
