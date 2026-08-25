/**
 * npm ETARGET — a version that does not exist.
 *
 * The sibling of the ERESOLVE recovery in `npmResolutionConflict.ts`, and the one nobody had
 * covered. npm answers a request for a version it has never published with:
 *
 *   npm error code ETARGET
 *   npm error notarget No matching version found for @types/react@^19.3.5.
 *
 * Run 17 of 2026-08-25 died on exactly this. The model asked for `@types/react@^19.3.5` — a
 * number it invented, by analogy with the `react@19.2.x` it had just seen — npm refused, and
 * with no directive for the case the model simply repeated the command until the circuit
 * breaker stopped the session at step 15, 0/13, five consecutive identical failures.
 *
 * The remedy is the one this codebase reaches for every time: ask the service that knows. The
 * registry publishes the real latest, so the directive names that number instead of leaving the
 * model to guess a second time — the same reason `npmResolutionConflict` copies npm's range
 * verbatim rather than composing one.
 *
 * Pure domain: the registry lookup is injected.
 */

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

/**
 * One instruction: install the version that exists.
 *
 * When the registry could not be reached, the directive still refuses the repeat but stops
 * short of naming a version — inventing one here would be the same defect that caused the
 * failure. It says to install unpinned instead, which lets npm choose, and npm cannot be wrong
 * about what npm publishes.
 */
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
