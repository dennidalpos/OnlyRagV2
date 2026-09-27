import { describe, it, expect } from 'vitest'
import { VERIFIED_MODELS, declaresToolCalling, findVerificationEvidence, resolveVerificationStatus } from './codingModelMatrix'

describe('resolveVerificationStatus', () => {
  it('marks a model the app has actually been run against as verified', () => {
    expect(resolveVerificationStatus({ modelName: 'qwen2.5-coder:7b', capabilities: ['completion', 'tools'] })).toBe('verified')
  })

  // The distinction the badge exists to make: catalogued and usable is not the same as tested.
  it('marks an installed untested tool model compatible, never verified', () => {
    expect(resolveVerificationStatus({ modelName: 'deepseek-coder:6.7b', capabilities: ['completion', 'tools'] })).toBe('compatible')
  })

  it('marks an unknown model without capability metadata as unknown', () => {
    expect(resolveVerificationStatus({ modelName: 'some-fork/custom:latest' })).toBe('unknown')
  })

  // The agent is a tool-calling loop; an embedding model has no chat surface at all.
  it('marks embedding families unsupported', () => {
    for (const name of ['nomic-embed-text:latest', 'mxbai-embed-large:latest', 'bge-m3:latest', 'embeddinggemma:latest']) {
      expect(resolveVerificationStatus({ modelName: name })).toBe('unsupported')
    }
  })

  it('marks an installed model that reports no tool capability as unsupported', () => {
    expect(resolveVerificationStatus({ modelName: 'deepseek-coder:6.7b', capabilities: ['completion'] })).toBe('unsupported')
  })

  // A model that is not installed yet reports no capabilities at all, and the badge still has
  // to render — the wizard shows it before the download.
  it('does not infer tool support before Ollama reports capabilities', () => {
    expect(resolveVerificationStatus({ modelName: 'deepseek-coder:6.7b' })).toBe('unknown')
  })

  it('answers unknown for an empty name instead of throwing', () => {
    expect(resolveVerificationStatus({ modelName: '' })).toBe('unknown')
  })
})

describe('VERIFIED_MODELS', () => {
  /** The rule this file exists to enforce. */
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
