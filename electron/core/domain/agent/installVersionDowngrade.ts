

import { major, maxSatisfying, valid, validRange } from 'semver'
import { extractRequestedPackages } from './installCommandParser'
import { majorOf } from './dependencyVersionReality'

/** A package an install command names together with an explicit version specifier. */
export interface InstallVersionTarget {
  name: string
  /** The specifier exactly as the command wrote it, e.g. `^16.8.0`. */
  spec: string
}

/** An install that would move a declared dependency backwards across a major boundary. */
export interface ManifestDowngrade {
  name: string
  /** The range the command asks for. */
  requested: string
  requestedMajor: number
  /** The range `package.json` declares today. */
  declared: string
  declaredMajor: number
}

/** Registry facts consumed structurally so the domain does not depend on the HTTP adapter. */
export interface RegistryPackageVersions {
  name: string
  exists: boolean
  latest?: string
  versions?: readonly string[]
}

export type RegistryInstallIssue =
  | { kind: 'unpublished'; name: string; requested: string; latest: string }
  | { kind: 'stale_major'; name: string; requested: string; resolved: string; latest: string }

/** The `name@spec` pairs an install command names. */
export function requestedInstallVersions(command: string): InstallVersionTarget[] {
  const named = extractRequestedPackages(command).filter((pkg) => pkg.hasExplicitVersion)
  if (named.length === 0) return []
  const tokens = (command || '').trim().split(/\s+/)
  const out: InstallVersionTarget[] = []
  for (const pkg of named) {
    const prefix = `${pkg.name}@`
    const token = tokens.find((tok) => tok.startsWith(prefix))
    if (token) out.push({ name: pkg.name, spec: token.slice(prefix.length) })
  }
  return out
}

/** Which of these install targets would take a package backwards past a major boundary. */
export function findManifestDowngrades(
  targets: readonly InstallVersionTarget[],
  declaredRanges: Readonly<Record<string, string>>
): ManifestDowngrade[] {
  const out: ManifestDowngrade[] = []
  for (const target of targets) {
    const declared = declaredRanges[target.name]
    if (typeof declared !== 'string') continue
    const requestedMajor = majorOf(target.spec)
    const declaredMajor = majorOf(declared)
    if (requestedMajor === null || declaredMajor === null) continue
    if (requestedMajor >= declaredMajor) continue
    out.push({ name: target.name, requested: target.spec, requestedMajor, declared, declaredMajor })
  }
  return out
}

/** Finds the first explicit install target contradicted by the registry. */
export function findRegistryInstallIssue(
  targets: readonly InstallVersionTarget[],
  declaredRanges: Readonly<Record<string, string>>,
  registryFacts: readonly RegistryPackageVersions[]
): RegistryInstallIssue | null {
  for (const target of targets) {
    const facts = registryFacts.find((item) => item.name === target.name)
    if (!facts?.exists || !facts.latest || !facts.versions || !validRange(target.spec)) continue
    const latest = valid(facts.latest)
    if (!latest) continue
    const resolved = maxSatisfying([...facts.versions], target.spec, { includePrerelease: true })
    if (!resolved) {
      return { kind: 'unpublished', name: target.name, requested: target.spec, latest }
    }
    if (typeof declaredRanges[target.name] === 'string') continue
    if (major(resolved) < major(latest)) {
      return { kind: 'stale_major', name: target.name, requested: target.spec, resolved, latest }
    }
  }
  return null
}

/** The refusal, in the shape the sibling refusal in this executor already uses: one prohibition, then one thing to do, and nothing else. */
export function buildInstallDowngradeRefusal(downgrade: ManifestDowngrade, latest?: string): string {
  const { name, requested, declared } = downgrade
  const latestNote = latest ? ` npm currently publishes ${name}@${latest}.` : ''
  return [
    `[VERSION DOWNGRADE REFUSED — INSTALL NOT RUN]`,
    `package.json declares "${name}": "${declared}" and this command would replace that declaration with "${requested}", a lower major.${latestNote}`,
    `The command was not executed. An install rewrites package.json in place, so this would pin the whole tree to ${name}@${downgrade.requestedMajor} and every later install of a package built for ${name}@${downgrade.declaredMajor} would fail on a peer conflict it is impossible to trace back here.`,
    `Directives:`,
    `1. Do NOT install ${name} below "${declared}", and do NOT add --force or --legacy-peer-deps.`,
    `2. Whatever demanded ${name}@${requested} is the side that does not fit this project: replace that package with one that supports ${name}@${downgrade.declaredMajor}, or drop it.`,
  ].join('\n')
}

/** One registry-backed replacement command; no guessed version and no failed install first. */
export function buildRegistryInstallRefusal(issue: RegistryInstallIssue): string {
  if (issue.kind === 'unpublished') {
    return [
      `[THAT VERSION DOES NOT EXIST — INSTALL NOT RUN]`,
      `${issue.name}@${issue.requested} matches no published version. The registry reports ${issue.name}@${issue.latest} as current.`,
      `The command was not executed because npm would reject it with ETARGET.`,
      `Directives:`,
      `1. Your next tool call MUST be "run_command" with: npm install ${issue.name}@${issue.latest}`,
      `2. Do NOT re-run the refused command, and do NOT guess another version.`,
    ].join('\n')
  }
  return [
    `[STALE INSTALL VERSION — INSTALL NOT RUN]`,
    `${issue.name}@${issue.requested} resolves to ${issue.resolved}, but the registry reports ${issue.name}@${issue.latest} as current.`,
    `This package is not declared in package.json, so there is no existing project constraint that justifies starting a new dependency on an older major.`,
    `Directives:`,
    `1. Your next tool call MUST be "run_command" with: npm install ${issue.name}@${issue.latest}`,
    `2. Do NOT re-run the refused command, and do NOT guess another version.`,
  ].join('\n')
}
