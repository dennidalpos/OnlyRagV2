declare const __APP_VERSION__: string | undefined
declare const __APP_AUTHOR__: string | undefined
declare const __APP_REPOSITORY_URL__: string | undefined
declare const __DEPENDENCY_VERSIONS__: Record<string, string> | undefined

/** Exact build baseline, not a probe of an external Sidecar or Ollama runtime. */
export const DEPENDENCY_VERSIONS: Readonly<Record<string, string>> =
  typeof __DEPENDENCY_VERSIONS__ === 'object' && __DEPENDENCY_VERSIONS__ ? __DEPENDENCY_VERSIONS__ : {}

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : '0.0.0'

export const APP_AUTHOR: string = typeof __APP_AUTHOR__ === 'string' && __APP_AUTHOR__ ? __APP_AUTHOR__ : 'OnlyRag Contributors'

export const APP_REPOSITORY_URL: string =
  typeof __APP_REPOSITORY_URL__ === 'string' && __APP_REPOSITORY_URL__ ? __APP_REPOSITORY_URL__ : 'https://github.com/dennidalpos/OnlyRagV2'

/** `owner/repo` slug derived from the repository URL, for compact display. */
export const APP_REPOSITORY_SLUG: string = APP_REPOSITORY_URL.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')
