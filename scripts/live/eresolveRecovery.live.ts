/**
 * Live scenario — recovery from an npm peer-version conflict.
 *
 * A focused probe rather than a whole task, because the conflict has to be unavoidable to
 * prove anything. Two earlier attempts failed to test what they meant to: given a manifest
 * that merely *declared* a conflicting pair, the model rewrote package.json and the conflict
 * disappeared before npm ever saw it.
 *
 * So vite@4 is really installed first, and the task names an explicit plugin version that
 * peer-requires a much newer vite. Now no rewrite of the manifest can dodge it.
 *
 * What to look for in logs/coding_agent_audit.log:
 *   - `[DEPENDENCY VERSION CONFLICT — ERESOLVE]` appears (npmResolutionConflict.ts fired)
 *   - the NEXT command the model runs is the upgrade the directive named
 *   - no `--force` / `--legacy-peer-deps` among the executed commands
 * and in this file's own output: VITE_INSTALLED moved off 4.5.14, PLUGIN_INSTALLED is present.
 *
 * Before the directive existed the model called `ask` here and the session ended; with a
 * two-option "pick one" wording it did the same. See buildNpmResolutionDirective.
 *
 *   npx vitest run --config vitest.live.config.mts -t "eresolve"
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'
import { runAgentOrchestratorLoop } from '../../electron/core/application/agentOrchestratorAppService'
import { loadRealSettings, reportRun, resetWorkspace } from './agentLiveHarness'

const WORKSPACE = path.join(os.homedir(), 'Desktop', 'onlyrag_live_eresolve')
const SESSION = 'live-eresolve'

/** The version the probe pins, and the plugin release that cannot coexist with it. */
const PINNED_VITE = '4.5.14'
const CONFLICTING_PLUGIN = '@vitejs/plugin-react@6.1.0'

function seedConflictingWorkspace(): void {
  resetWorkspace(WORKSPACE)
  fs.mkdirSync(path.join(WORKSPACE, 'src'), { recursive: true })
  fs.writeFileSync(
    path.join(WORKSPACE, 'package.json'),
    JSON.stringify(
      {
        name: 'eresolve-probe',
        version: '1.0.0',
        private: true,
        scripts: { build: 'vite build' },
        dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' },
        devDependencies: { vite: PINNED_VITE },
      },
      null,
      2
    ),
    'utf-8'
  )
  fs.writeFileSync(
    path.join(WORKSPACE, 'index.html'),
    '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
    'utf-8'
  )
  fs.writeFileSync(
    path.join(WORKSPACE, 'src', 'main.jsx'),
    "import { createRoot } from 'react-dom/client'\ncreateRoot(document.getElementById('root')).render('ok')\n",
    'utf-8'
  )

  // Really installed, so npm reports `Found: vite@4.5.14` from the tree and not from the
  // manifest — the manifest is the part the model is free to rewrite.
  execSync('npm install --no-audit --no-fund', { cwd: WORKSPACE, stdio: 'ignore' })
}

function installedVersion(pkg: string): string | null {
  const manifest = path.join(WORKSPACE, 'node_modules', ...pkg.split('/'), 'package.json')
  return fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, 'utf-8')).version : null
}

describe('live: eresolve recovery', () => {
  it('resolves a peer-version conflict instead of asking or forcing', async () => {
    const settings = loadRealSettings({ maxToolCallSteps: 16 } as never)
    seedConflictingWorkspace()

    const result = await runAgentOrchestratorLoop(
      {
        userTask:
          `Use npm for every command (not pnpm, not yarn). Run exactly this command first: \`npm install ${CONFLICTING_PLUGIN}\`. ` +
          'It will fail. Resolve the failure so the install succeeds, then run `npm run build` and make it pass. Do not rewrite src files.',
        workspacePath: WORKSPACE,
        agentMode: 'agent',
        sessionId: SESSION,
        settings,
      },
      null
    )

    reportRun({
      label: 'eresolve recovery',
      workspacePath: WORKSPACE,
      sessionId: SESSION,
      success: result.success,
      summary: result.summary,
    })
    console.log(`vite installed: ${installedVersion('vite')} (started at ${PINNED_VITE})`)
    console.log(`plugin installed: ${installedVersion('@vitejs/plugin-react')}`)

    expect(result).toBeTruthy()
  })
})
