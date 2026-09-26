/** `No matching version found for <pkg>@<range>` — npm's own phrasing, both spacings. */

import { diagnosticAdvice, renderAdvice } from './diagnosticAdvice'
const NO_MATCHING_VERSION = /no matching version found for\s+((?:@[^\s@/]+\/)?[^\s@]+)@([^\s.]+(?:\.[^\s.]+)*)\.?/i

export interface VersionNotFound {
  packageName: string
  requestedRange: string
}

/** The package and range npm refused, or null when the output is not an ETARGET failure. */
export function parseVersionNotFound(output: string): VersionNotFound | null {
  const text = output || ''
  if (!/etarget|no matching version found/i.test(text)) return null
  const match = NO_MATCHING_VERSION.exec(text)
  if (!match) return null
  return { packageName: match[1], requestedRange: match[2].replace(/\.$/, '') }
}

/** One fix, as advice: install the version that exists. */
export function buildVersionNotFoundNote(found: VersionNotFound, latest?: string): string {
  const target = latest ? `${found.packageName}@${latest}` : found.packageName
  const advice = diagnosticAdvice(
    `[THAT VERSION DOES NOT EXIST — npm ETARGET]`,
    [
      latest
        ? `${found.packageName}@${found.requestedRange} has never been published. The registry was asked: the current version is ${latest}.`
        : `${found.packageName}@${found.requestedRange} has never been published, and the registry could not be reached to name the current one.`,
      `You cannot know published version numbers from memory, and repeating the command cannot change what exists.`,
    ],
    `"run_command" with: npm install ${target}`,
    [`Do NOT re-run the failed command, and do NOT guess another number.`],
  )
  return `\n\n${renderAdvice(advice)}`
}
