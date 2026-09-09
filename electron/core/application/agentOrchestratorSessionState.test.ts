import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { revalidateRestoredMilestones } from './agentOrchestratorSessionState'
import { captureMilestoneFileEvidence } from '../infrastructure/filesystem/workspaceDeliverableProbe'

describe('revalidateRestoredMilestones', () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })))

  it('keeps matching fingerprints and invalidates modified files, missing files, and commands', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-resume-'))
    dirs.push(workspace)
    fs.writeFileSync(path.join(workspace, 'fresh.ts'), 'export const fresh = true')
    fs.writeFileSync(path.join(workspace, 'changed.ts'), 'export const changed = false')
    const freshMilestone = { id: 'm-1', title: 'Fresh file', status: 'verified' as const, filePaths: ['fresh.ts'] }
    const changedMilestone = { id: 'm-2', title: 'Changed file', status: 'verified' as const, filePaths: ['changed.ts'] }
    const freshEvidence = captureMilestoneFileEvidence(workspace, freshMilestone)
    const changedEvidence = captureMilestoneFileEvidence(workspace, changedMilestone)
    fs.writeFileSync(path.join(workspace, 'changed.ts'), 'export const changed = true')

    const restored = revalidateRestoredMilestones([
      { ...freshMilestone, fileEvidence: freshEvidence },
      { ...changedMilestone, fileEvidence: changedEvidence },
      { id: 'm-3', title: 'Missing file', status: 'verified', filePaths: ['missing.ts'] },
      { id: 'm-4', title: 'Verified build', status: 'verified', verificationCommand: 'npm test' },
    ], workspace)

    expect(restored.map((item) => item.status)).toEqual(['verified', 'pending', 'pending', 'in_progress'])
    expect(restored[1].notes).toContain('changed')
    expect(restored[3].notes).toContain('rerun verification')
  })

  it('invalidates legacy verified file evidence without a persisted fingerprint', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-resume-'))
    dirs.push(workspace)
    fs.writeFileSync(path.join(workspace, 'legacy.ts'), 'export const legacy = true')

    const [restored] = revalidateRestoredMilestones([
      { id: 'm-1', title: 'Legacy file', status: 'verified', filePaths: ['legacy.ts'] },
    ], workspace)

    expect(restored.status).toBe('pending')
    expect(restored.notes).toContain('changed')
  })
})
