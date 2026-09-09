/** Compares declared dependencies with injected registry facts and emits one remediation. */

import { maxSatisfying, valid, validRange } from 'semver'

export interface DeclaredDependency {
  name: string
  /** The range as written, e.g. `^4.7.3`. */
  range: string
}

export interface RegistryFact {
  name: string
  exists: boolean
  latest?: string
  versions?: readonly string[]
}

export interface VersionRealityFindings {
  nonexistent: string[]
  unpublished: Array<{ name: string; declared: string; latest: string }>
  outdated: Array<{ name: string; declared: string; latest: string }>
}

/** Every dependency a manifest declares, across both dependency blocks. */
export function declaredDependencies(packageJson: unknown): DeclaredDependency[] {
  const manifest = packageJson as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null
  if (!manifest || typeof manifest !== 'object') return []
  const out: DeclaredDependency[] = []
  for (const block of [manifest.dependencies, manifest.devDependencies]) {
    if (!block || typeof block !== 'object') continue
    for (const [name, range] of Object.entries(block)) {
      if (typeof range === 'string') out.push({ name, range })
    }
  }
  return out
}

/** The leading integer of a semver range, ignoring `^`, `~`, `>=` and friends. */
export function majorOf(range: string): number | null {
  const match = /(\d+)/.exec(range || '')
  return match ? Number(match[1]) : null
}

/**
 * What the registry says about what the manifest declares.
 *
 * A package the registry could not be reached about is reported as neither: an unreachable
 * network must never present as "this package does not exist".
 */
/**
 * Packages whose major bump rewrites the configuration, not just the version string.
 *
 * Reporting these backfires, and two runs measured it. Run 12 and run 18 of 2026-08-25 both
 * took `typescript` to 7 on this directive's advice and then died in `tsconfig.json`:
 * `TS5108 Option 'moduleResolution=node10' has been removed`, `TS5102 Option 'baseUrl' has been
 * removed`. The model writes the config it learned, which predates the compiler it was just
 * told to install, and no amount of retrying teaches it the new shape — run 18 rewrote
 * `tsconfig.json` seventeen times and finished 1/14.
 *
 * So the rule follows the evidence rather than the tidy principle: report a stale major only
 * where the fix really is the number. `tailwindcss` is here for the same reason — v4 replaced
 * the directive-and-config model wholesale — and `eslint` for flat config. Runtime libraries
 * stay reported, because there the version IS the whole change.
 *
 * This is a knowledge-cutoff problem, not a version problem, and it is the honest boundary of
 * what this directive can fix.
 */
const CONFIG_BREAKING_ON_MAJOR = new Set(['typescript', 'tailwindcss', 'eslint'])

export function findVersionReality(declared: DeclaredDependency[], facts: RegistryFact[]): VersionRealityFindings {
  const byName = new Map(facts.map((f) => [f.name, f]))
  const findings: VersionRealityFindings = { nonexistent: [], unpublished: [], outdated: [] }

  for (const dep of declared) {
    const fact = byName.get(dep.name)
    if (!fact) continue
    if (!fact.exists) {
      findings.nonexistent.push(dep.name)
      continue
    }
    if (!fact.latest) continue
    if (fact.versions && validRange(dep.range) && valid(fact.latest)
      && !maxSatisfying([...fact.versions], dep.range, { includePrerelease: true })) {
      findings.unpublished.push({ name: dep.name, declared: dep.range, latest: fact.latest })
      continue
    }
    if (CONFIG_BREAKING_ON_MAJOR.has(dep.name)) continue
    const declaredMajor = majorOf(dep.range)
    const latestMajor = majorOf(fact.latest)
    if (declaredMajor !== null && latestMajor !== null && latestMajor > declaredMajor) {
      findings.outdated.push({ name: dep.name, declared: dep.range, latest: fact.latest })
    }
  }
  return findings
}

/**
 * One instruction, and the non-existent package wins when both are present.
 *
 * Ordering matters for the reason §5.6 established: a message carries one instruction for now.
 * An invented package blocks every install in the same command, so it is dealt with first; the
 * stale versions are still declared afterwards and will be reported again.
 *
 * The second line of each directive says what NOT to do, never a second thing to do. The first
 * draft ended with *"Then install again, so node_modules matches"* — two imperatives in one
 * message, the exact defect this codebase has removed four times — and run 14 of 2026-08-25
 * shows the model doing the cheaper second one: `npm install` repeated until the loop guard
 * aborted the session at step 21, 0/12, with the manifest never rewritten.
 */
export function buildVersionRealityDirective(findings: VersionRealityFindings): string | null {
  if (findings.nonexistent.length > 0) {
    const names = findings.nonexistent
    return [
      `\n\n[THESE PACKAGES DO NOT EXIST ON NPM]`,
      `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} declared in package.json and the npm registry has never heard of ${names.length === 1 ? 'it' : 'them'}. No install can ever succeed, whatever flags you add.`,
      `Directives:`,
      `1. Your next tool call MUST be "write_file" on "package.json", with the complete file and ${names.length === 1 ? 'that entry' : 'those entries'} removed.`,
      `2. Do NOT try to install ${names.length === 1 ? 'it' : 'them'} again, with or without flags. Once the manifest is clean, the files importing ${names.length === 1 ? 'it' : 'them'} are the next thing the compiler will name.`,
    ].join('\n')
  }

  if (findings.unpublished.length > 0) {
    const shown = findings.unpublished.slice(0, 5)
    return [
      `\n\n[THESE VERSION RANGES MATCH NO PUBLISHED RELEASE]`,
      ...shown.map((item) => `- ${item.name}: you declared ${item.declared}, npm currently publishes ${item.latest}`),
      `No install can succeed while package.json contains ${shown.length === 1 ? 'this range' : 'these ranges'}.`,
      `Directives:`,
      `1. Your next tool call MUST be "write_file" on "package.json", with the complete file and ${shown.length === 1 ? 'that range' : 'those ranges'} replaced by the current version${shown.length === 1 ? '' : 's'} above.`,
      `2. Do NOT run an install first and do NOT guess another version.`,
    ].join('\n')
  }

  if (findings.outdated.length > 0) {
    const shown = findings.outdated.slice(0, 5)
    return [
      `\n\n[THESE VERSIONS ARE MAJOR RELEASES BEHIND — THE REGISTRY WAS ASKED]`,
      ...shown.map((o) => `- ${o.name}: you declared ${o.declared}, npm currently publishes ${o.latest}`),
      `You cannot know current versions from memory, so these numbers come from the registry itself. An old major is where "cannot find module", peer conflicts and unparseable type definitions come from.`,
      `Directives:`,
      `1. Your next tool call MUST be "write_file" on "package.json", with the complete file and ${shown.length === 1 ? 'that range' : 'those ranges'} updated to the version${shown.length === 1 ? '' : 's'} named above.`,
      `2. Do NOT run an install first. While the manifest still declares the old range, installing reinstalls exactly what is already there. The install matters only after the file is written.`,
    ].join('\n')
  }

  return null
}
