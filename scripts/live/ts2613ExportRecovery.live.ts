/**
 * Live scenario — recovery from a default import against a named local export.
 *
 * TS2613 is the inverse of the TS2614 probe: the compiler prints the complete named import
 * that fixes the importer, while the exported module is held constant. The scenario observes
 * whether the real local model follows that verbatim suggestion.
 *
 *   npx vitest run --config vitest.live.config.mts -t "TS2613"
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runAgentOrchestratorLoop } from '../../electron/core/application/agentOrchestratorAppService'
import { agentSessionStateRepository } from '../../electron/core/infrastructure/filesystem/agentSessionStateRepository'
import { loadRealSettings, reportRun, resetWorkspace } from './agentLiveHarness'

const WORKSPACE = path.join(os.homedir(), 'Desktop', 'onlyrag_live_ts2613')
const SESSION = 'live-ts2613'

function seedWorkspace(): { packageJson: string; widgetSource: string } {
  resetWorkspace(WORKSPACE)
  fs.mkdirSync(path.join(WORKSPACE, 'src'), { recursive: true })
  fs.mkdirSync(path.join(WORKSPACE, 'node_modules', 'typescript'), { recursive: true })
  fs.mkdirSync(path.join(WORKSPACE, 'node_modules', '.bin'), { recursive: true })

  const packageJson = JSON.stringify(
    {
      name: 'ts2613-probe',
      version: '1.0.0',
      private: true,
      scripts: { build: 'tsc --noEmit' },
    },
    null,
    2
  )
  const widgetSource = 'export const Widget = "widget"\n'
  fs.writeFileSync(path.join(WORKSPACE, 'package.json'), packageJson, 'utf-8')
  fs.writeFileSync(
    path.join(WORKSPACE, 'tsconfig.json'),
    JSON.stringify(
      { compilerOptions: { strict: true, module: 'commonjs', target: 'es2020', moduleResolution: 'node' }, include: ['src'] },
      null,
      2
    ),
    'utf-8'
  )
  fs.writeFileSync(path.join(WORKSPACE, 'src', 'Widget.ts'), widgetSource, 'utf-8')
  fs.writeFileSync(path.join(WORKSPACE, 'src', 'Dashboard.ts'), "import Widget from './Widget'\nexport const dashboard = Widget\n", 'utf-8')
  fs.cpSync(path.join(process.cwd(), 'node_modules', 'typescript'), path.join(WORKSPACE, 'node_modules', 'typescript'), { recursive: true })
  for (const launcher of ['tsc', 'tsc.cmd', 'tsc.ps1']) {
    const source = path.join(process.cwd(), 'node_modules', '.bin', launcher)
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(WORKSPACE, 'node_modules', '.bin', launcher))
  }
  return { packageJson, widgetSource }
}

describe('live: TS2613 export recovery', () => {
  it('rewrites the importer using the compiler suggestion', async () => {
    const fixture = seedWorkspace()
    await agentSessionStateRepository.seedPlanMilestones(
      SESSION,
      WORKSPACE,
      [{ id: 'm-ts2613', title: 'Fix src/Dashboard.ts', status: 'pending', verificationCommand: 'npm run build' }],
      'Fix the TypeScript build error in src/Dashboard.ts.'
    )

    const result = await runAgentOrchestratorLoop(
      {
        userTask:
          'Run `npm run build` first and fix the TypeScript error in src/Dashboard.ts. ' +
          'The local module src/Widget.ts is correct and must not be edited. Stop only after npm run build passes.',
        workspacePath: WORKSPACE,
        agentMode: 'agent',
        sessionId: SESSION,
        settings: loadRealSettings({ codingModel: 'qwen2.5-coder:7b', maxToolCallSteps: 12 } as never),
      },
      null
    )

    const metrics = reportRun({ label: 'TS2613 export recovery', workspacePath: WORKSPACE, sessionId: SESSION, success: result.success, summary: result.summary })
    const source = fs.readFileSync(path.join(WORKSPACE, 'src', 'Dashboard.ts'), 'utf-8')

    expect(metrics.commands.some((command) => command.includes('npm run build'))).toBe(true)
    expect(result.success).toBe(true)
    expect(source).toContain("import { Widget } from './Widget'")
    expect(source).not.toContain("import Widget from './Widget'")
    expect(fs.readFileSync(path.join(WORKSPACE, 'src', 'Widget.ts'), 'utf-8')).toBe(fixture.widgetSource)
    expect(fs.readFileSync(path.join(WORKSPACE, 'package.json'), 'utf-8')).toBe(fixture.packageJson)
  })
})
