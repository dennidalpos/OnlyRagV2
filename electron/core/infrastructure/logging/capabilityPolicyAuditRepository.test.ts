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
    expect(await repository.load()).toHaveLength(1)
    expect(await repository.append({ invalid: true } as never)).toBe(false)
  })

  it('retains only the latest 1000 events', async () => {
    // Seed just below the bound, then cross it through real durable appends. Rewriting
    // every growing prefix 1005 times measures quadratic fixture setup, not retention.
    const seed = Array.from({ length: 995 }, (_, index) => ({ ...event(index), target: '[url]', reason: 'Rejected [url]' }))
    fs.writeFileSync(path.join(tempDir, 'audit.json'), JSON.stringify(seed), 'utf-8')
    for (let index = 995; index < 1005; index += 1) {
      expect(await repository.append(event(index))).toBe(true)
      const current = await repository.load()
      expect(current.map((item) => item.auditId)).toEqual(
        Array.from({ length: Math.min(1000, index + 1) }, (_, offset) => `audit-${Math.max(0, index - 999) + offset}`),
      )
    }
    // Read through a fresh repository to prove persistence, not an in-memory view.
    repository = new CapabilityPolicyAuditRepository(path.join(tempDir, 'audit.json'))
    const loaded = await repository.load()
    expect(loaded.map((item) => item.auditId)).toEqual(Array.from({ length: 1000 }, (_, index) => `audit-${index + 5}`))
    expect(loaded.every((item) => item.target === '[url]' && !item.reason.includes('secret-value'))).toBe(true)
  })

  it('does not lose events during concurrent appends', async () => {
    await Promise.all(Array.from({ length: 10 }, (_, index) => repository.append(event(index))))
    const loaded = await repository.load()
    expect(loaded.map((item) => item.auditId)).toEqual(Array.from({ length: 10 }, (_, index) => `audit-${index}`))
  })
})
