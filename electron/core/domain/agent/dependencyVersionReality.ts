/** Compares declared dependencies with injected registry facts and emits one remediation. */

import { maxSatisfying, valid, validRange } from 'semver'
import { diagnosticAdvice, parseRenderedAdvice, renderAdvice, type DiagnosticAdvice } from './diagnosticAdvice'

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

/** What the registry says about what the manifest declares. */
/** Packages whose major bump rewrites the configuration, not just the version string. */
export const CONFIG_BREAKING_ON_MAJOR: ReadonlySet<string> = new Set(['typescript', 'tailwindcss', 'eslint'])

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
    if (fact.versions && validRange(dep.range) && valid(fact.latest) && !maxSatisfying([...fact.versions], dep.range, { includePrerelease: true })) {
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

/** The manifest fix that blocks every install, or null; a non-existent package wins over an unpublished range. */
function blockingManifestAdvice(findings: VersionRealityFindings): DiagnosticAdvice | null {
  if (findings.nonexistent.length > 0) {
    const names = findings.nonexistent
    return diagnosticAdvice(
      `[THESE PACKAGES DO NOT EXIST ON NPM]`,
      [
        `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} declared in package.json and the npm registry has never heard of ${names.length === 1 ? 'it' : 'them'}. No install can ever succeed, whatever flags you add.`,
      ],
      `"write_file" on "package.json", with the complete file and ${names.length === 1 ? 'that entry' : 'those entries'} removed.`,
      [
        `Do NOT try to install ${names.length === 1 ? 'it' : 'them'} again, with or without flags. Once the manifest is clean, the files importing ${names.length === 1 ? 'it' : 'them'} are the next thing the compiler will name.`,
      ],
    )
  }

  if (findings.unpublished.length > 0) {
    const shown = findings.unpublished.slice(0, 5)
    return diagnosticAdvice(
      `[THESE VERSION RANGES MATCH NO PUBLISHED RELEASE]`,
      [
        ...shown.map((item) => `- ${item.name}: you declared ${item.declared}, npm currently publishes ${item.latest}`),
        `No install can succeed while package.json contains ${shown.length === 1 ? 'this range' : 'these ranges'}.`,
      ],
      `"write_file" on "package.json", with the complete file and ${shown.length === 1 ? 'that range' : 'those ranges'} replaced by the current version${shown.length === 1 ? '' : 's'} above.`,
      [`Do NOT run an install first and do NOT guess another version.`],
    )
  }
  return null
}

/** The tool-result note on registry facts that contradict package.json: one fix, as advice. */
export function buildVersionRealityNote(findings: VersionRealityFindings): string | null {
  const blocking = blockingManifestAdvice(findings)
  if (blocking) return `\n\n${renderAdvice(blocking)}`

  if (findings.outdated.length > 0) {
    const shown = findings.outdated.slice(0, 5)
    return [
      `\n\n[THESE VERSIONS ARE MAJOR RELEASES BEHIND — THE REGISTRY WAS ASKED]`,
      ...shown.map((o) => `- ${o.name}: you declared ${o.declared}, npm currently publishes ${o.latest}`),
      `These numbers come from the registry itself. An old major still installs, but it is a common source of "cannot find module", peer conflicts and unparseable type definitions.`,
      `Consider updating ${shown.length === 1 ? 'that range' : 'those ranges'} in package.json before installing, unless the task asks for the older version.`,
    ].join('\n')
  }

  return null
}

/** Headings of the fixes above that make every install fail until package.json changes. */
const BLOCKING_MANIFEST_MARKERS = ['[THESE PACKAGES DO NOT EXIST ON NPM]', '[THESE VERSION RANGES MATCH NO PUBLISHED RELEASE]']

/**
 * The manifest rewrite a tool result advised and no later write of package.json has answered, or
 * null; the arbiter turns it into the turn's order. Without it the arbiter kept ordering
 * `npm install` (run_command only) while the tool result asked for a package.json rewrite the turn
 * policy then refused: 28 denied writes and a `no_mutation` stop in the full-task run of 2026-09-24.
 */
export function pendingManifestAdvice(
  recentLogs: readonly { step: number; output: string }[],
  episodes: readonly { step?: number; tool: string; target?: string; status: 'SUCCESS' | 'FAILURE' | 'BLOCKED' }[],
): DiagnosticAdvice | null {
  for (let i = recentLogs.length - 1; i >= 0; i--) {
    const log = recentLogs[i]
    const start = BLOCKING_MANIFEST_MARKERS.map((marker) => log.output.lastIndexOf(marker)).reduce((a, b) => Math.max(a, b), -1)
    if (start < 0) continue
    const answered = episodes.some(
      (e) => (e.step ?? 0) > log.step && e.status === 'SUCCESS' && e.tool === 'write_file' && /(^|[\\/])package\.json$/i.test((e.target || '').trim()),
    )
    if (answered) return null
    return parseRenderedAdvice(log.output.slice(start))
  }
  return null
}
