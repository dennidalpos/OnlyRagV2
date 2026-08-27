import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { snapshotLiveAuditLogs } from '../../../scripts/live/agentLiveHarness'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('snapshotLiveAuditLogs', () => {
  it('copies current and rotated audit logs into a timestamped run directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-live-snapshot-'))
    tempRoots.push(root)
    const sourceDir = path.join(root, 'logs')
    const destinationRoot = path.join(root, 'snapshots')
    fs.mkdirSync(sourceDir)
    fs.writeFileSync(path.join(sourceDir, 'coding_agent_audit.log'), 'current', 'utf-8')
    fs.writeFileSync(path.join(sourceDir, 'coding_agent_audit.1.log'), 'rotated', 'utf-8')

    const snapshotDir = snapshotLiveAuditLogs({
      sessionId: 'session-1',
      label: 'full task/run',
      sourceLogPath: path.join(sourceDir, 'coding_agent_audit.log'),
      destinationRoot,
    })

    expect(path.dirname(snapshotDir)).toBe(destinationRoot)
    expect(fs.readFileSync(path.join(snapshotDir, 'coding_agent_audit.log'), 'utf-8')).toBe('current')
    expect(fs.readFileSync(path.join(snapshotDir, 'coding_agent_audit.1.log'), 'utf-8')).toBe('rotated')
    expect(JSON.parse(fs.readFileSync(path.join(snapshotDir, 'manifest.json'), 'utf-8'))).toMatchObject({
      sessionId: 'session-1',
      label: 'full task/run',
    })
  })

  it('fails clearly when neither audit-log generation exists', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-live-snapshot-'))
    tempRoots.push(root)

    expect(() =>
      snapshotLiveAuditLogs({
        sessionId: 'session-2',
        label: 'missing',
        sourceLogPath: path.join(root, 'coding_agent_audit.log'),
        destinationRoot: path.join(root, 'snapshots'),
      })
    ).toThrow('No coding agent audit log found for live run session-2')
  })
})
