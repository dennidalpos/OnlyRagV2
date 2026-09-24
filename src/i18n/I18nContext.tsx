import React, { createContext, useContext, useState, useCallback, useMemo } from 'react'
import { Language, TranslationSchema } from './types'
import { it } from './locales/it'
import { en } from './locales/en'
import { logger } from '../lib/logger'
import { errorMessage } from '../../shared/domain/errors/errorMessage'

type NestedKeyOf<ObjectType extends object> = {
  [Key in keyof ObjectType & (string | number)]: ObjectType[Key] extends object ? `${Key}.${NestedKeyOf<ObjectType[Key]>}` : `${Key}`
}[keyof ObjectType & (string | number)]

export type TranslationKey = NestedKeyOf<TranslationSchema>

export interface I18nContextType {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
  dict: TranslationSchema
}

const dictionaries: Record<Language, TranslationSchema> = {
  it,
  en,
}

const I18nContext = createContext<I18nContextType | null>(null)

/** Language of the mounted I18nProvider, for code outside React (error normalizer, services). */
let activeLanguage: Language = 'it'

function lookup(dictionary: TranslationSchema, key: string): string | undefined {
  let current: unknown = dictionary
  for (const part of key.split('.')) {
    if (current && typeof current === 'object' && part in current) current = (current as Record<string, unknown>)[part]
    else return undefined
  }
  return typeof current === 'string' ? current : undefined
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  return params ? Object.entries(params).reduce((acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)), template) : template
}

/** Non-hook translation in the active provider language (Italian fallback, then the key itself). */
export function translate(key: TranslationKey, params?: Record<string, string | number>): string {
  return interpolate(lookup(dictionaries[activeLanguage], key) ?? lookup(dictionaries.it, key) ?? key, params)
}

interface I18nProviderProps {
  children: React.ReactNode
  initialLanguage?: Language
  onLanguageChange?: (lang: Language) => void
}

export const I18nProvider: React.FC<I18nProviderProps> = ({ children, initialLanguage, onLanguageChange }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    if (initialLanguage && (initialLanguage === 'it' || initialLanguage === 'en')) {
      return initialLanguage
    }
    try {
      // Check system language
      const navLang = navigator?.language?.toLowerCase() || ''
      if (navLang.startsWith('en')) {
        return 'en'
      }
    } catch (err: unknown) {
      logger.warn('I18n', `Could not read initial language preference: ${errorMessage(err)}`)
    }
    return 'it'
  })

  const setLanguage = useCallback(
    (newLang: Language) => {
      setLanguageState(newLang)
      onLanguageChange?.(newLang)
    },
    [onLanguageChange],
  )

  const dict = useMemo(() => dictionaries[language] || dictionaries.it, [language])
  activeLanguage = language

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>): string => {
      const keys = key.split('.')
      let current: any = dict
      let fallback: any = dictionaries.it

      for (const k of keys) {
        if (current && typeof current === 'object' && k in current) {
          current = current[k]
        } else {
          current = undefined
          break
        }
      }

      // Fallback if key missing in selected language
      if (current === undefined || typeof current !== 'string') {
        for (const k of keys) {
          if (fallback && typeof fallback === 'object' && k in fallback) {
            fallback = fallback[k]
          } else {
            fallback = undefined
            break
          }
        }
        current = fallback || key
      }

      if (typeof current !== 'string') {
        return key
      }

      if (params) {
        return Object.entries(params).reduce((acc, [paramKey, paramValue]) => acc.replaceAll(`{${paramKey}}`, String(paramValue)), current)
      }

      return current
    },
    [dict],
  )

  const contextValue = useMemo<I18nContextType>(
    () => ({
      language,
      setLanguage,
      t,
      dict,
    }),
    [language, setLanguage, t, dict],
  )

  return <I18nContext.Provider value={contextValue}>{children}</I18nContext.Provider>
}

export const useTranslation = (): I18nContextType => {
  const context = useContext(I18nContext)
  if (!context) {
    // Fallback for non-wrapped tests/components
    return {
      language: 'it',
      setLanguage: () => {},
      t: (key: TranslationKey, params?: Record<string, string | number>) => {
        const keys = key.split('.')
        let current: any = it
        for (const k of keys) {
          if (current && typeof current === 'object' && k in current) {
            current = current[k]
          } else {
            return key
          }
        }
        if (typeof current !== 'string') return key
        return params ? Object.entries(params).reduce((acc, [paramKey, paramValue]) => acc.replaceAll(`{${paramKey}}`, String(paramValue)), current) : current
      },
      dict: it,
    }
  }
  return context
}
