/** `No matching version found for <pkg>@<range>` — npm's own phrasing, both spacings. */
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

/** One instruction: install the version that exists. */
export function buildVersionNotFoundDirective(found: VersionNotFound, latest?: string): string {
  const target = latest ? `${found.packageName}@${latest}` : found.packageName
  return [
    `\n\n[THAT VERSION DOES NOT EXIST — npm ETARGET]`,
    latest
      ? `${found.packageName}@${found.requestedRange} has never been published. The registry was asked: the current version is ${latest}.`
      : `${found.packageName}@${found.requestedRange} has never been published, and the registry could not be reached to name the current one.`,
    `You cannot know published version numbers from memory, and repeating the command cannot change what exists.`,
    `Directives:`,
    `1. Your next tool call MUST be "run_command" with: npm install ${target}`,
    `2. Do NOT re-run the failed command, and do NOT guess another number.`,
  ].join('\n')
}
