import { describe, it, expect } from 'vitest'
import {
  buildFallbackChain,
  parseCatalogSizeGB,
  DEEP_REASONING_TIER_CATALOG,
  FAST_TIER_CATALOG,
  STANDARD_TIER_CATALOG,
} from './hardwareModelCatalog'
import { CPU_INFERENCE_WEIGHT_BUDGET_GB } from './hardwareProfileTiers'

describe('hardwareModelCatalog — fallback chain construction', () => {
  it('should parse both GB and MB size labels', () => {
    expect(parseCatalogSizeGB('4.7 GB')).toBeCloseTo(4.7, 5)
    expect(parseCatalogSizeGB('820 MB')).toBeCloseTo(0.8008, 3)
    expect(parseCatalogSizeGB('nonsense')).toBe(Number.POSITIVE_INFINITY)
    expect(parseCatalogSizeGB('')).toBe(Number.POSITIVE_INFINITY)
  })

  it('should put the profile-curated model at the head of the cascade', () => {
    expect(buildFallbackChain(DEEP_REASONING_TIER_CATALOG, { profileTier: 'midrange', budgetGB: 4.5 })[0])
      .toBe('deepseek-r1:7b')
    expect(buildFallbackChain(DEEP_REASONING_TIER_CATALOG, { profileTier: 'highend', budgetGB: 10.5 })[0])
      .toBe('qwen2.5-coder:14b')
    expect(buildFallbackChain(DEEP_REASONING_TIER_CATALOG, { profileTier: 'extreme', budgetGB: 16.5 })[0])
      .toBe('gpt-oss:20b')
    expect(buildFallbackChain(STANDARD_TIER_CATALOG, { profileTier: 'legacy', budgetGB: CPU_INFERENCE_WEIGHT_BUDGET_GB })[0])
      .toBe('qwen2.5-coder:3b')
  })

  it('should rank every within-budget candidate ahead of every over-budget one', () => {
    const budgetGB = 5.0
    const chain = buildFallbackChain(DEEP_REASONING_TIER_CATALOG, { profileTier: 'midrange', budgetGB })
    const sizeOf = (name: string) =>
      parseCatalogSizeGB(DEEP_REASONING_TIER_CATALOG.find((e) => e.modelName === name)!.sizeBytesApprox)

    // Skip the curated head, which is intentionally exempt from the size ordering.
    const tail = chain.slice(1)
    const firstOverBudgetIndex = tail.findIndex((name) => sizeOf(name) > budgetGB)
    expect(firstOverBudgetIndex).toBeGreaterThan(0)
    expect(tail.slice(0, firstOverBudgetIndex).every((name) => sizeOf(name) <= budgetGB)).toBe(true)
    expect(tail.slice(firstOverBudgetIndex).every((name) => sizeOf(name) > budgetGB)).toBe(true)
  })

  it('should order within-budget candidates largest-first and over-budget candidates smallest-first', () => {
    const budgetGB = 10.0
    const chain = buildFallbackChain(DEEP_REASONING_TIER_CATALOG, { profileTier: 'highend', budgetGB }).slice(1)
    const sizeOf = (name: string) =>
      parseCatalogSizeGB(DEEP_REASONING_TIER_CATALOG.find((e) => e.modelName === name)!.sizeBytesApprox)

    const within = chain.filter((n) => sizeOf(n) <= budgetGB).map(sizeOf)
    const over = chain.filter((n) => sizeOf(n) > budgetGB).map(sizeOf)

    expect(within).toEqual([...within].sort((a, b) => b - a))
    expect(over).toEqual([...over].sort((a, b) => a - b))
  })

  it('should reach the 32B models only once the budget can host them', () => {
    const tight = buildFallbackChain(DEEP_REASONING_TIER_CATALOG, { profileTier: 'extreme', budgetGB: 16.5 })
    const roomy = buildFallbackChain(DEEP_REASONING_TIER_CATALOG, { profileTier: 'extreme', budgetGB: 34.5 })

    // 24GB card (safe budget 16.5GB): a 20GB model is over budget, so it is ranked last.
    expect(tight.indexOf('qwen2.5-coder:32b')).toBeGreaterThan(tight.indexOf('qwen2.5-coder:14b'))
    // 48GB card (safe budget 34.5GB): it now fits, so it leads the non-curated candidates.
    expect(roomy.indexOf('qwen2.5-coder:32b')).toBeLessThan(roomy.indexOf('qwen2.5-coder:14b'))
    expect(roomy[1]).toBe('qwen2.5-coder:32b')
  })

  it('should keep a CPU-only cascade below the CPU throughput ceiling before anything larger', () => {
    const chain = buildFallbackChain(DEEP_REASONING_TIER_CATALOG, {
      profileTier: 'legacy',
      budgetGB: CPU_INFERENCE_WEIGHT_BUDGET_GB,
    })
    const sizeOf = (name: string) =>
      parseCatalogSizeGB(DEEP_REASONING_TIER_CATALOG.find((e) => e.modelName === name)!.sizeBytesApprox)

    expect(chain[0]).toBe('qwen3:4b')
    // Everything that fits the 3.0GB CPU ceiling precedes the first candidate that does not.
    const firstTooBig = chain.findIndex((n) => sizeOf(n) > CPU_INFERENCE_WEIGHT_BUDGET_GB)
    expect(chain.slice(0, firstTooBig).every((n) => sizeOf(n) <= CPU_INFERENCE_WEIGHT_BUDGET_GB)).toBe(true)
  })

  it('should never emit duplicate tags in a cascade', () => {
    for (const catalog of [FAST_TIER_CATALOG, STANDARD_TIER_CATALOG, DEEP_REASONING_TIER_CATALOG]) {
      for (const profileTier of ['legacy', 'entry', 'midrange', 'highend', 'extreme'] as const) {
        const chain = buildFallbackChain(catalog, { profileTier, budgetGB: 10 })
        expect(new Set(chain).size).toBe(chain.length)
        expect(chain.length).toBe(catalog.length)
      }
    }
  })
})
