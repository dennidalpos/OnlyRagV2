/**
 * Live scenario — recovery from a package import that names unavailable exports.
 *
 * The package is declared and installed as a local fixture before the agent starts. Its
 * declaration file exports `Dialog`, `Menu`, `Listbox` and `Switch`, while the source imports
 * `Card` and `List`. The task forbids changing the manifest and node_modules, so a passing build
 * requires the model to follow the TS2305 directive and rewrite the importer.
 *
 *   npx vitest run --config vitest.live.config.mts -t "TS2305"
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runAgentOrchestratorLoop } from '../../electron/core/application/agentOrchestratorAppService'
import { agentSessionStateRepository } from '../../electron/core/infrastructure/filesystem/agentSessionStateRepository'
import { loadRealSettings, reportRun, resetWorkspace } from './agentLiveHarness'

const WORKSPACE = path.join(os.homedir(), 'Desktop', 'onlyrag_live_ts2305')
const SESSION = 'live-ts2305'
const PACKAGE_NAME = 'onlyrag-export-probe'

function seedWorkspace(): { packageJson: string; packageTypes: string } {
  resetWorkspace(WORKSPACE)
  fs.mkdirSync(path.join(WORKSPACE, 'src'), { recursive: true })
  fs.mkdirSync(path.join(WORKSPACE, 'node_modules', PACKAGE_NAME), { recursive: true })

  const packageJson = JSON.stringify(
    {
      name: 'ts2305-probe',
      version: '1.0.0',
      private: true,
      scripts: { build: 'tsc --noEmit' },
      dependencies: { [PACKAGE_NAME]: '1.0.0' },
    },
    null,
    2
  )
  const packageTypes = [
    'export declare const Dialog: any',
    'export declare const Menu: any',
    'export declare const Listbox: any',
    'export declare const Switch: any',
  ].join('\n') + '\n'

  fs.writeFileSync(path.join(WORKSPACE, 'package.json'), packageJson, 'utf-8')
  fs.writeFileSync(
    path.join(WORKSPACE, 'tsconfig.json'),
    JSON.stringify(
      { compilerOptions: { strict: true, module: 'commonjs', target: 'es2020', moduleResolution: 'node', jsx: 'preserve' }, include: ['src'] },
      null,
      2
    ),
    'utf-8'
  )
  fs.writeFileSync(path.join(WORKSPACE, 'src', 'global.d.ts'), 'declare namespace JSX { interface IntrinsicElements { [element: string]: any } }\n', 'utf-8')
  fs.writeFileSync(path.join(WORKSPACE, 'src', 'TaskCard.tsx'), `import { Card, List } from '${PACKAGE_NAME}'\n\nexport const taskCard = Card + List\n`, 'utf-8')
  fs.writeFileSync(
    path.join(WORKSPACE, 'node_modules', PACKAGE_NAME, 'package.json'),
    JSON.stringify({ name: PACKAGE_NAME, version: '1.0.0', types: 'index.d.ts' }, null, 2),
    'utf-8'
  )
  fs.writeFileSync(path.join(WORKSPACE, 'node_modules', PACKAGE_NAME, 'index.d.ts'), packageTypes, 'utf-8')
  return { packageJson, packageTypes }
}

describe('live: TS2305 export recovery', () => {
  it('rewrites the importer using the package export list', async () => {
    const fixture = seedWorkspace()
    await agentSessionStateRepository.seedPlanMilestones(
      SESSION,
      WORKSPACE,
      [{ id: 'm-ts2305', title: 'Fix src/TaskCard.tsx', status: 'pending', verificationCommand: 'npm run build' }],
      'Fix the TypeScript build error in src/TaskCard.tsx.'
    )

    const result = await runAgentOrchestratorLoop(
      {
        userTask:
          `Run \`npm run build\` first and fix every error in src/TaskCard.tsx. ` +
          `The package ${PACKAGE_NAME} and node_modules are already correct: do not edit package.json, ` +
          'do not edit node_modules, and do not install any package. Stop only after npm run build passes.',
        workspacePath: WORKSPACE,
        agentMode: 'agent',
        sessionId: SESSION,
        settings: loadRealSettings({ codingModel: 'qwen2.5-coder:7b', maxToolCallSteps: 12 } as never),
      },
      null
    )

    const metrics = reportRun({ label: 'TS2305 export recovery', workspacePath: WORKSPACE, sessionId: SESSION, success: result.success, summary: result.summary })
    const source = fs.readFileSync(path.join(WORKSPACE, 'src', 'TaskCard.tsx'), 'utf-8')

    expect(metrics.commands.some((command) => command.includes('npm run build'))).toBe(true)
    expect(result.success).toBe(true)
    const importLine = source.split('\n').find((line) => line.trimStart().startsWith('import ')) || ''
    expect(importLine).not.toMatch(/\b(Card|List)\b/)
    expect(importLine).toMatch(/\b(Dialog|Menu|Listbox|Switch)\b/)
    expect(fs.readFileSync(path.join(WORKSPACE, 'package.json'), 'utf-8')).toBe(fixture.packageJson)
    expect(fs.readFileSync(path.join(WORKSPACE, 'node_modules', PACKAGE_NAME, 'index.d.ts'), 'utf-8')).toBe(fixture.packageTypes)
  })
})
