import { describe, it, expect } from 'vitest'
import {
  VERIFIED_MODELS,
  declaresToolCalling,
  findVerificationEvidence,
  resolveVerificationStatus,
  selectWizardCodingSet,
} from './codingModelMatrix'
import type { HardwareProfileTier } from '../../shared/domain/hardware/hardwareProfileTiers'

function entry(modelName: string, profiles: HardwareProfileTier[]) {
  return { modelName, recommendedForProfiles: profiles }
}

describe('resolveVerificationStatus', () => {
  it('marks a model the app has actually been run against as verified', () => {
    expect(
      resolveVerificationStatus({ modelName: 'qwen2.5-coder:7b', isCatalogued: true, capabilities: ['completion', 'tools'] })
    ).toBe('verified')
  })

  // The distinction the badge exists to make: catalogued and usable is not the same as tested.
  it('marks a catalogued but untested model compatible, never verified', () => {
    expect(
      resolveVerificationStatus({ modelName: 'deepseek-coder:6.7b', isCatalogued: true, capabilities: ['completion', 'tools'] })
    ).toBe('compatible')
  })

  it('marks a tag the catalog has never heard of as unknown', () => {
    expect(resolveVerificationStatus({ modelName: 'some-fork/custom:latest', isCatalogued: false })).toBe('unknown')
  })

  // The agent is a tool-calling loop; an embedding model has no chat surface at all.
  it('marks embedding families unsupported whatever the catalog says', () => {
    for (const name of ['nomic-embed-text:latest', 'mxbai-embed-large:latest', 'bge-m3:latest', 'embeddinggemma:latest']) {
      expect(resolveVerificationStatus({ modelName: name, isCatalogued: true })).toBe('unsupported')
    }
  })

  it('marks an installed model that reports no tool capability as unsupported', () => {
    expect(
      resolveVerificationStatus({ modelName: 'deepseek-coder:6.7b', isCatalogued: true, capabilities: ['completion'] })
    ).toBe('unsupported')
  })

  // A model that is not installed yet reports no capabilities at all, and the badge still has
  // to render — the wizard shows it before the download.
  it('does not punish a model merely for not being installed', () => {
    expect(resolveVerificationStatus({ modelName: 'deepseek-coder:6.7b', isCatalogued: true })).toBe('compatible')
  })

  it('answers unknown for an empty name instead of throwing', () => {
    expect(resolveVerificationStatus({ modelName: '', isCatalogued: true })).toBe('unknown')
  })
})

describe('VERIFIED_MODELS', () => {
  /**
   * The rule this file exists to enforce. A green tick shown to a user who cannot check it is
   * exactly the kind of unearned claim the rest of this codebase keeps having to remove, so
   * every entry has to carry the run behind it.
   */
  it('records evidence for every entry: a date, the probes, and what the run showed', () => {
    expect(VERIFIED_MODELS.length).toBeGreaterThan(0)
    for (const record of VERIFIED_MODELS) {
      expect(record.evidence.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(record.evidence.probes.length).toBeGreaterThan(0)
      expect(record.evidence.outcome.length).toBeGreaterThan(40)
    }
  })

  it('exposes that evidence for the badge tooltip', () => {
    const evidence = findVerificationEvidence('qwen2.5-coder:7b')!
    expect(evidence.probes).toContain('fullTaskRun.live.ts')
  })

  it('has no evidence to offer for anything else', () => {
    expect(findVerificationEvidence('deepseek-coder:6.7b')).toBeNull()
  })
})

describe('declaresToolCalling', () => {
  it('reads the capability Ollama actually reports', () => {
    expect(declaresToolCalling(['completion', 'tools'])).toBe(true)
    expect(declaresToolCalling(['completion'])).toBe(false)
    expect(declaresToolCalling(undefined)).toBe(false)
  })
})

describe('selectWizardCodingSet', () => {
  const catalog = [
    entry('deepseek-coder:6.7b', ['midrange']),
    entry('qwen2.5-coder:7b', ['midrange', 'highend']),
    entry('qwen2.5-coder:3b', ['legacy', 'entry']),
    entry('qwen3-coder:30b', []),
  ]

  it('returns only what fits the tier', () => {
    expect(selectWizardCodingSet(catalog, 'entry').map((e) => e.modelName)).toEqual(['qwen2.5-coder:3b'])
  })

  it('puts the verified model first, so one click installs the tested one', () => {
    expect(selectWizardCodingSet(catalog, 'midrange').map((e) => e.modelName)).toEqual([
      'qwen2.5-coder:7b',
      'deepseek-coder:6.7b',
    ])
  })

  // A wizard that installs a model too large for the machine has done real harm; "nothing fits"
  // is an answer the UI can act on.
  it('returns nothing rather than a model that does not fit', () => {
    expect(selectWizardCodingSet([entry('qwen3-coder:30b', ['extreme'])], 'legacy')).toEqual([])
  })

  it('does not mutate the catalog it was given', () => {
    const original = catalog.map((e) => e.modelName)
    selectWizardCodingSet(catalog, 'midrange')
    expect(catalog.map((e) => e.modelName)).toEqual(original)
  })
})
