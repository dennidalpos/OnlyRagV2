/**
 * Install Version Downgrade.
 *
 * The half of the version reality check that `dependencyVersionReality.ts` structurally cannot
 * see: a manifest mutation driven by a **command** instead of by `write_file`.
 *
 * `versionRealityDirective` in agentToolExecutorService.ts is gated on the written path — it
 * only runs when the tool is `write_file` and the target is `package.json`. But `npm install
 * pkg@range` rewrites `package.json` in place too, and nothing was reading the manifest back
 * afterwards, so a version installed by command was never compared against anything.
 *
 * What that cost, measured in `logs/coding_agent_audit.log`, session `live-full-task` of
 * 2026-08-25T12:11 on `qwen2.5-coder:7b`, in a project whose manifest declared `react@^18.2.0`:
 *
 *     [step 21] SUCCESS npm install react@^16.8.0
 *     [step 30] SUCCESS npm install react@^16.8.0
 *     [step 31] SUCCESS npm install react@^16.8.0
 *
 * Three downgrades, all successful, none contested. The manifest afterwards read
 * `react@"^16.14.0" from the root project` — npm had rewritten the declaration the model
 * itself had chosen. The cascade is in the same log: at steps 45-46 `npm install
 * @mui/material` failed with **ERESOLVE**, not 404, because the tree was pinned to
 * `react@16.14.0`; the uninstallable-package directive then read that repeated failure as proof
 * the name was made up and ordered its removal, and at step 49 the model deleted a legitimate
 * dependency. One unchecked downgrade, four wasted steps and a correct package thrown away.
 *
 * And the command was not even the model's idea. Every one of those three installs was copied
 * verbatim out of the ERESOLVE directive (`npmResolutionConflict.ts`), which had faithfully
 * reported npm's own words — `peer react@"^16.8.0" from use-optimistic@1.0.0` — and turned them
 * into `npm install react@^16.8.0`. That directive picks the highest alternative of the peer
 * range but never asks which DIRECTION the move goes, so a junk transitive package
 * (`use-optimistic`, itself on the invented-packages list in `PROJECT_STATUS.json`) was allowed
 * to drag the root project's runtime library back two majors. A guard that only watched what the
 * model invents would have missed this entirely; this one watches the command, whoever wrote it.
 *
 * ## Why a downgrade is a different finding from a version that does not exist
 *
 * A non-existent version is impossible and npm says so itself, loudly and immediately
 * (`ETARGET`, already handled by `npmVersionNotFound.ts`). A downgrade is perfectly possible —
 * that is exactly the problem. It succeeds, exit code 0, and the damage only surfaces several
 * steps later as somebody else's ERESOLVE. Nothing downstream can attribute it back. So this is
 * the one finding that has to be caught BEFORE the command runs.
 *
 * ## Why the CONFIG_BREAKING_ON_MAJOR exclusion does not apply here
 *
 * `dependencyVersionReality.ts` refuses to report a stale major for `typescript`,
 * `tailwindcss` and `eslint`, because telling the model to UPGRADE those hands it a compiler or
 * a config format it has never seen and it then rewrites `tsconfig.json` seventeen times (runs
 * 12 and 18 of 2026-08-25). That reasoning is about the cost of moving forward into unknown
 * configuration, and it does not transfer: refusing a downgrade moves nothing. It leaves the
 * project on the version it already compiles against, which is the safest state available, and
 * `typescript@4` replacing `typescript@5` under a `tsconfig.json` written for 5 is exactly as
 * destructive as `react@16` under code written for 18. So no package is excluded here.
 *
 * `react` in particular does not belong in that set on its own merits either — it is a runtime
 * library, where the version IS the whole change, which is the line the sibling module already
 * draws when it says runtime libraries stay reported.
 *
 * Pure domain: command text and the manifest's declared ranges in, verdict out.
 */

import { extractRequestedPackages } from './installCommandParser'
import { majorOf } from './dependencyVersionReality'
import { major, maxSatisfying, validRange } from 'semver'

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

/**
 * The `name@spec` pairs an install command names.
 *
 * `installCommandParser.ts` stays the single authority on WHICH packages a command names — it
 * already owns the flag stripping and the scoped-name rule, and a second copy of that would
 * drift within a week, which is the reason that module was extracted in the first place. It
 * deliberately keeps only a `hasExplicitVersion` boolean and discards the specifier, so the only
 * thing done here is reading the tail off the token it already identified.
 *
 * A bare `npm install`, a non-install command, or a target with no version all yield nothing.
 */
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

/**
 * Which of these install targets would take a package backwards past a major boundary.
 *
 * Only packages the manifest ALREADY declares are considered, and only a strictly lower major
 * counts. Both restrictions are what keeps this free of false positives:
 *
 *  * A package the project does not declare yet has no prior choice to contradict — the first
 *    install of a dependency is not a downgrade of anything, whatever version it names.
 *  * A minor or patch move backwards (`^18.3.1` → `^18.2.0`) does not break the tree and is not
 *    worth a turn, which is the same threshold `findVersionReality` already applies.
 *  * `latest`, `next`, a git URL or any other non-numeric specifier yields no major and is left
 *    alone rather than guessed at.
 */
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

/**
 * Finds the first explicit install target contradicted by the registry.
 *
 * A parseable range that matches no published version is impossible and would otherwise spend a
 * command on ETARGET. For a first install only, resolving below the registry's current major is
 * stale scaffolding rather than a project compatibility decision. Declared dependencies stay
 * under the manifest rule above: their existing range is the project's source of truth.
 *
 * Missing version data is deliberately inconclusive. The HTTP adapter uses that shape for
 * network failures, and an unreachable registry must never become a false refusal.
 */
export function findRegistryInstallIssue(
  targets: readonly InstallVersionTarget[],
  declaredRanges: Readonly<Record<string, string>>,
  registryFacts: readonly RegistryPackageVersions[]
): RegistryInstallIssue | null {
  for (const target of targets) {
    const facts = registryFacts.find((item) => item.name === target.name)
    if (!facts?.exists || !facts.latest || !facts.versions || !validRange(target.spec)) continue
    const resolved = maxSatisfying([...facts.versions], target.spec, { includePrerelease: true })
    if (!resolved) {
      return { kind: 'unpublished', name: target.name, requested: target.spec, latest: facts.latest }
    }
    if (typeof declaredRanges[target.name] === 'string') continue
    if (major(resolved) < major(facts.latest)) {
      return { kind: 'stale_major', name: target.name, requested: target.spec, resolved, latest: facts.latest }
    }
  }
  return null
}

/**
 * The refusal, in the shape the sibling refusal in this executor already uses: one prohibition,
 * then one thing to do, and nothing else.
 *
 * The command is NOT run, unlike a bad `write_file`, which is kept because the code it wrote is
 * usually most of the way right. There is no such salvage here: an install has no partial value,
 * and the state it would leave — a rewritten manifest plus a repinned `node_modules` — is
 * precisely the damage. Refusing costs nothing and leaves the project on the tree it was
 * already building against.
 *
 * The second directive names the other side of the conflict rather than the version, because the
 * measured case had the model arriving here holding an ERESOLVE directive that told it to run
 * exactly this command. Repeating "keep react at ^18" would leave it with two live instructions
 * and no way to choose; naming the requirer as the thing that does not fit replaces the older
 * instruction outright, per §6.2.2.
 *
 * `latest` is optional on purpose: the verdict is decided entirely against the manifest, so an
 * unreachable registry weakens the message by one sentence instead of suppressing the refusal.
 */
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
