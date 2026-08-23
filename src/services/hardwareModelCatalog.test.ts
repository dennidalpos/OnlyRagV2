import { describe, it, expect } from 'vitest'
import {
  parseCatalogSizeGB,
  REASONING_CODING_CATALOG,
  COMPACT_CODING_CATALOG,
  WORKHORSE_CODING_CATALOG,
  LARGE_CODING_CATALOG,
} from './hardwareModelCatalog'

describe('hardwareModelCatalog', () => {
  it('should parse both GB and MB size labels', () => {
    expect(parseCatalogSizeGB('4.7 GB')).toBeCloseTo(4.7, 5)
    expect(parseCatalogSizeGB('820 MB')).toBeCloseTo(0.8008, 3)
    expect(parseCatalogSizeGB('nonsense')).toBe(Number.POSITIVE_INFINITY)
    expect(parseCatalogSizeGB('')).toBe(Number.POSITIVE_INFINITY)
  })

  it('should give every catalog entry a parseable size label', () => {
    // A row whose size cannot be parsed reads as POSITIVE_INFINITY, which would make it look
    // like it exceeds every VRAM budget on every host.
    const catalogs = [
      COMPACT_CODING_CATALOG,
      WORKHORSE_CODING_CATALOG,
      REASONING_CODING_CATALOG,
      LARGE_CODING_CATALOG,
    ]
    for (const catalog of catalogs) {
      for (const entry of catalog) {
        expect(parseCatalogSizeGB(entry.sizeBytesApprox), entry.modelName).toBeLessThan(Number.POSITIVE_INFINITY)
      }
    }
  })

  it('should keep the workhorse ladder in WORKHORSE_CODING_CATALOG covering every hardware profile', () => {
    // The single coding-model recommendation is derived exclusively from this catalog
    // (see buildCodingModelCatalog in hardwareRecommendationEngine.ts), so a profile missing
    // from the ladder would leave that hardware class with no recommended model at all.
    for (const profile of ['legacy', 'entry', 'midrange', 'highend', 'extreme'] as const) {
      const curated = WORKHORSE_CODING_CATALOG.filter((e) => e.recommendedForProfiles.includes(profile))
      expect(curated.length, `no workhorse model curated for '${profile}'`).toBeGreaterThanOrEqual(1)
    }
  })
})
