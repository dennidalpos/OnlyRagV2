import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CapabilityPolicyAuditRepository } from './capabilityPolicyAuditRepository'

const event = (index: number) => ({
  auditId: `audit-${index}`,
  sessionId: 'session-1',
  timestamp: '2026-08-27T15:00:00.000Z',
  capability: 'http-download' as const,
  operation: 'download' as const,
  toolName: 'download_file',
  target: 'https://example.test/file.zip?token=secret-value',
  mode: 'network-approved' as const,
  allowed: false,
  reason: 'Rejected https://example.test/file.zip?token=secret-value',
})

describe('CapabilityPolicyAuditRepository', () => {
  let tempDir: string
  let repository: CapabilityPolicyAuditRepository

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-policy-audit-'))
    repository = new CapabilityPolicyAuditRepository(path.join(tempDir, 'audit.json'))
  })

  afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  it('persists validated and redacted audit events', async () => {
    expect(await repository.append(event(1))).toBe(true)
    const loaded = await repository.load()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].target).toBe('[url]')
    expect(loaded[0].reason).not.toContain('secret-value')
  })

  it('ignores malformed persisted entries and invalid new events', async () => {
    const filePath = path.join(tempDir, 'audit.json')
    fs.writeFileSync(filePath, JSON.stringify([event(1), { invalid: true }]), 'utf-8')
    expect((await repository.load())).toHaveLength(1)
    expect(await repository.append({ invalid: true } as any)).toBe(false)
  })

  it('retains only the latest 1000 events', async () => {
    for (let index = 0; index < 1005; index += 1) await repository.append(event(index))
    const loaded = await repository.load()
    expect(loaded).toHaveLength(1000)
    expect(loaded[0].auditId).toBe('audit-5')
    expect(loaded.at(-1)?.auditId).toBe('audit-1004')
  })

  it('does not lose events during concurrent appends', async () => {
    await Promise.all(Array.from({ length: 10 }, (_, index) => repository.append(event(index))))
    const loaded = await repository.load()
    expect(loaded.map((item) => item.auditId)).toEqual(Array.from({ length: 10 }, (_, index) => `audit-${index}`))
  })
})
