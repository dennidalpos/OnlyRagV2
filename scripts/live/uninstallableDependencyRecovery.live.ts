import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runAgentOrchestratorLoop } from '../../electron/core/application/agentOrchestratorAppService'
import { agentSessionStateRepository } from '../../electron/core/infrastructure/filesystem/agentSessionStateRepository'
import { liveWorkspacePath, loadRealSettings, reportRun, resetWorkspace } from './agentLiveHarness'

const WORKSPACE = liveWorkspacePath('uninstallable_dependency')
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
    2,
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
      isAvailable: () => true,
      send: (_channel: string, payload: unknown) => emittedLogs.push((payload as { message?: string }).message || ''),
    }
    const fixture = seedWorkspace()
    await agentSessionStateRepository.seedPlanMilestones(
      SESSION,
      WORKSPACE,
      [{ id: 'm-uninstallable', title: 'Fix src/Dashboard.ts', status: 'pending' }],
      'Remove the unavailable package import from src/Dashboard.ts.',
    )

    const result = await runAgentOrchestratorLoop(
      {
        userTask:
          `Run exactly \`npm install ${PACKAGE_NAME}\` first. It must fail because the package is unavailable. ` +
          'After the failure, remove that import from src/Dashboard.ts with one write_file call. ' +
          'Do not run another install and do not edit package.json. Stop after the file is fixed.',
        workspacePath: WORKSPACE,
        agentMode: 'auto',
        sessionId: SESSION,
        settings: loadRealSettings({ codingModel: 'qwen2.5-coder:7b', maxToolCallSteps: 10 } as never),
      },
      liveWindow,
    )

    const metrics = reportRun({
      label: 'uninstallable dependency recovery',
      workspacePath: WORKSPACE,
      sessionId: SESSION,
      success: result.success,
      summary: result.summary,
    })
    const source = fs.readFileSync(path.join(WORKSPACE, 'src', 'Dashboard.ts'), 'utf-8')
    expect(metrics.commands.some((command) => command.includes(`npm install ${PACKAGE_NAME}`))).toBe(true)
    expect(metrics.commands.filter((command) => command.includes(`npm install ${PACKAGE_NAME}`))).toHaveLength(1)
    // A passing build is structural evidence only, so an honest finish closes as unverifiable, not success.
    expect(metrics).toMatchObject({ verified: 1, failed: 0, pending: 0, completionStatus: 'unverifiable' })
    expect(result).toMatchObject({ success: false, completionStatus: 'unverifiable' })
    expect(source).not.toMatch(new RegExp(`from\\s+['"]${PACKAGE_NAME.replace('/', '\\/')}['"]`))
    expect(source).not.toContain('missingWidget')
    expect(fs.readFileSync(path.join(WORKSPACE, 'package.json'), 'utf-8')).toBe(fixture.packageJson)
    expect(source).not.toBe(fixture.source)
    expect(emittedLogs.some((message) => message.includes('Context policy [dependencies_uninstallable]'))).toBe(true)
    expect(emittedLogs.some((message) => message.includes('omitting repo map'))).toBe(true)
  })
})
