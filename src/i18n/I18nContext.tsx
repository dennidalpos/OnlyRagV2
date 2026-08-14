import React, { createContext, useContext, useState, useCallback, useMemo } from 'react'
import { Language, TranslationSchema } from './types'
import { it } from './locales/it'
import { en } from './locales/en'
import { logger } from '../lib/logger'

type NestedKeyOf<ObjectType extends object> = {
  [Key in keyof ObjectType & (string | number)]: ObjectType[Key] extends object
    ? `${Key}.${NestedKeyOf<ObjectType[Key]>}`
    : `${Key}`
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

interface I18nProviderProps {
  children: React.ReactNode
  initialLanguage?: Language
  onLanguageChange?: (lang: Language) => void
}

export const I18nProvider: React.FC<I18nProviderProps> = ({
  children,
  initialLanguage,
  onLanguageChange,
}) => {
  const [language, setLanguageState] = useState<Language>(() => {
    if (initialLanguage && (initialLanguage === 'it' || initialLanguage === 'en')) {
      return initialLanguage
    }
    try {
      const saved = localStorage.getItem('onlyrag_language') as Language
      if (saved === 'it' || saved === 'en') {
        return saved
      }
      // Check system language
      const navLang = navigator?.language?.toLowerCase() || ''
      if (navLang.startsWith('en')) {
        return 'en'
      }
    } catch {}
    return 'it'
  })

  const setLanguage = useCallback((newLang: Language) => {
    setLanguageState(newLang)
    try {
      localStorage.setItem('onlyrag_language', newLang)
    } catch (err: any) {
      logger.error('I18n', `Failed persisting language to localStorage: ${err.message}`)
    }
    onLanguageChange?.(newLang)
  }, [onLanguageChange])

  const dict = useMemo(() => dictionaries[language] || dictionaries.it, [language])

  const t = useCallback((key: TranslationKey, params?: Record<string, string | number>): string => {
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
      return Object.entries(params).reduce(
        (acc, [paramKey, paramValue]) => acc.replaceAll(`{${paramKey}}`, String(paramValue)),
        current
      )
    }

    return current
  }, [dict])

  const contextValue = useMemo<I18nContextType>(
    () => ({
      language,
      setLanguage,
      t,
      dict,
    }),
    [language, setLanguage, t, dict]
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
      t: (key: TranslationKey) => {
        const keys = key.split('.')
        let current: any = it
        for (const k of keys) {
          if (current && typeof current === 'object' && k in current) {
            current = current[k]
          } else {
            return key
          }
        }
        return typeof current === 'string' ? current : key
      },
      dict: it,
    }
  }
  return context
}
