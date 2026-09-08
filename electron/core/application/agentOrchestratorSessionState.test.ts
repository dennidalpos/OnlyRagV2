import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { revalidateRestoredMilestones } from './agentOrchestratorSessionState'

describe('revalidateRestoredMilestones', () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })))

  it('keeps fresh file evidence and invalidates stale files and commands', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-resume-'))
    dirs.push(workspace)
    fs.writeFileSync(path.join(workspace, 'fresh.ts'), 'export const fresh = true')

    const restored = revalidateRestoredMilestones([
      { id: 'm-1', title: 'Fresh file', status: 'verified', filePaths: ['fresh.ts'] },
      { id: 'm-2', title: 'Missing file', status: 'verified', filePaths: ['missing.ts'] },
      { id: 'm-3', title: 'Verified build', status: 'verified', verificationCommand: 'npm test' },
    ], workspace)

    expect(restored.map((item) => item.status)).toEqual(['verified', 'pending', 'in_progress'])
    expect(restored[2].notes).toContain('rerun verification')
  })
})
