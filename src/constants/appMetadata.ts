

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
