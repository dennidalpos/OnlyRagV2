import type { it } from './locales/it'

export type Language = 'it' | 'en'

type WidenStrings<T> = { [K in keyof T]: T[K] extends string ? string : WidenStrings<T[K]> }

/** Shape of every locale: the Italian dictionary with its literal strings widened. */
export type TranslationSchema = WidenStrings<typeof it>
