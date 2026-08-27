/**
 * Live scenario — plan compilation against a project that already exists.
 *
 * The empty-workspace probe cannot prove that workspace inspection and the project's declared
 * check are reconciled. This fixture has a real manifest, source file and build script before
 * planning starts; the assertion therefore observes the same path a user with an existing
 * project takes.
 *
 *   npx vitest run --config vitest.live.config.mts -t "pre-seeded"
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadRealSettings, resetWorkspace, seedGeneratedPlan } from './agentLiveHarness'

const WORKSPACE = path.join(os.homedir(), 'Desktop', 'onlyrag_live_preseeded')
const SESSION = 'live-preseeded'

function seedExistingWorkspace(): void {
  resetWorkspace(WORKSPACE)
  fs.mkdirSync(path.join(WORKSPACE, 'src'), { recursive: true })
  fs.writeFileSync(
    path.join(WORKSPACE, 'package.json'),
    JSON.stringify(
      {
        name: 'preseeded-probe',
        version: '1.0.0',
        private: true,
        scripts: { build: 'tsc --noEmit' },
      },
      null,
      2
    ),
    'utf-8'
  )
  fs.writeFileSync(path.join(WORKSPACE, 'src', 'App.tsx'), 'export function App() { return null }\n', 'utf-8')
}

describe('live: pre-seeded workspace', () => {
  it('adds the existing project build to the generated plan', async () => {
    seedExistingWorkspace()
    const settings = loadRealSettings({ codingModel: 'qwen2.5-coder:7b' } as never)

    const seeded = await seedGeneratedPlan({
      sessionId: SESSION,
      workspacePath: WORKSPACE,
      userTask: 'Improve the existing dashboard while preserving its current project structure.',
      settings,
      interviewPolicy: 'skip',
    })

    const runnable = seeded.milestones.find((milestone) => milestone.verificationCommand === 'npm run build')
    expect(runnable, 'the existing project build was not carried into the plan').toBeDefined()
    expect(seeded.milestones.some((milestone) => milestone.title.includes('package.json'))).toBe(false)
  })
})
