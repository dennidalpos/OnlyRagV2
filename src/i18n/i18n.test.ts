import { describe, it as test, expect } from 'vitest'
import { it as itLocale } from './locales/it'
import { en as enLocale } from './locales/en'

// Helper to recursively collect all keys
function collectKeys(obj: any, prefix = ''): string[] {
  let keys: string[] = []
  for (const k of Object.keys(obj)) {
    const nextPrefix = prefix ? `${prefix}.${k}` : k
    if (typeof obj[k] === 'object' && obj[k] !== null) {
      keys = keys.concat(collectKeys(obj[k], nextPrefix))
    } else {
      keys.push(nextPrefix)
    }
  }
  return keys.sort()
}

describe('i18n Localization Unit Tests', () => {
  test('should have matching translation keys between Italian and English dictionaries', () => {
    const itKeys = collectKeys(itLocale)
    const enKeys = collectKeys(enLocale)

    expect(itKeys).toEqual(enKeys)
    expect(itKeys.length).toBeGreaterThan(20)
  })

  test('should have non-empty string values for all keys in Italian dictionary', () => {
    const itKeys = collectKeys(itLocale)
    for (const key of itKeys) {
      const parts = key.split('.')
      let val: any = itLocale
      for (const p of parts) {
        val = val[p]
      }
      expect(typeof val).toBe('string')
      expect(val.trim().length).toBeGreaterThan(0)
    }
  })

  test('should have non-empty string values for all keys in English dictionary', () => {
    const enKeys = collectKeys(enLocale)
    for (const key of enKeys) {
      const parts = key.split('.')
      let val: any = enLocale
      for (const p of parts) {
        val = val[p]
      }
      expect(typeof val).toBe('string')
      expect(val.trim().length).toBeGreaterThan(0)
    }
  })
})
