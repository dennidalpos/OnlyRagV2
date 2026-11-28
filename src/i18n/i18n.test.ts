import { describe, it as test, expect } from 'vitest'
import { it as itSchema } from './locales/it'
import { en as enSchema } from './locales/en'

type LocaleTree = { readonly [key: string]: string | LocaleTree }

const itLocale = itSchema as unknown as LocaleTree
const enLocale = enSchema as unknown as LocaleTree

// Helper to recursively collect all keys
function collectKeys(obj: LocaleTree, prefix = ''): string[] {
  let keys: string[] = []
  for (const k of Object.keys(obj)) {
    const nextPrefix = prefix ? `${prefix}.${k}` : k
    const value = obj[k]
    if (typeof value === 'object' && value !== null) {
      keys = keys.concat(collectKeys(value, nextPrefix))
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
      let val: string | LocaleTree = itLocale
      for (const p of parts) {
        val = (val as LocaleTree)[p]
      }
      expect(typeof val).toBe('string')
      expect(String(val).trim().length).toBeGreaterThan(0)
    }
  })

  test('should have non-empty string values for all keys in English dictionary', () => {
    const enKeys = collectKeys(enLocale)
    for (const key of enKeys) {
      const parts = key.split('.')
      let val: string | LocaleTree = enLocale
      for (const p of parts) {
        val = (val as LocaleTree)[p]
      }
      expect(typeof val).toBe('string')
      expect(String(val).trim().length).toBeGreaterThan(0)
    }
  })

  test('keeps the placeholders of every Main timeline template in both languages', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
    for (const [key, template] of Object.entries(itSchema.agentMain)) {
      expect(placeholders(enSchema.agentMain[key as keyof typeof itSchema.agentMain]), key).toEqual(placeholders(template))
    }
  })
})
