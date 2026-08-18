/**
 * Application identity injected at build time from package.json (see `define` in
 * vite.config.mts and vitest.config.mts).
 *
 * The About dialog used to render `t('common.version')` and `t('common.author')` as if they
 * were values, so it displayed the literal labels "Versione" and "Autore" instead of the
 * actual version and the actual author. Those i18n keys are field labels and stay labels;
 * the values come from here.
 */

declare const __APP_VERSION__: string | undefined
declare const __APP_AUTHOR__: string | undefined
declare const __APP_REPOSITORY_URL__: string | undefined

export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : '0.0.0'

export const APP_AUTHOR: string =
  typeof __APP_AUTHOR__ === 'string' && __APP_AUTHOR__ ? __APP_AUTHOR__ : 'OnlyRag Contributors'

export const APP_REPOSITORY_URL: string =
  typeof __APP_REPOSITORY_URL__ === 'string' && __APP_REPOSITORY_URL__
    ? __APP_REPOSITORY_URL__
    : 'https://github.com/dennidalpos/OnlyRagV2'

/** `owner/repo` slug derived from the repository URL, for compact display. */
export const APP_REPOSITORY_SLUG: string = APP_REPOSITORY_URL.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')
