import { declaredDependencies } from '../../dependencyVersionReality'
import { extractRequestedPackages } from '../../installCommandParser'
import {
  requestedInstallVersions,
  findManifestDowngrades,
  findRegistryInstallIssue,
  buildInstallDowngradeRefusal,
  buildRegistryInstallRefusal,
} from '../../installVersionDowngrade'

export interface InstallPackageFacts {
  name: string
  latest?: string
  versions?: string[]
  exists: boolean
}

export interface InstallRefusal {
  refusal: string
  name: string
}

export interface RegistryInstallRefusal extends InstallRefusal {
  kind: 'unpublished' | 'stale_major'
}

type LookupPackages = (names: string[]) => Promise<InstallPackageFacts[]>

/** Returns the first explicitly requested package that the registry says is absent. */
export async function firstNonexistentInstallTarget(
  command: string,
  lookupPackages: LookupPackages,
): Promise<string | null> {
  const requested = extractRequestedPackages(command)
  if (requested.length === 0) return null
  const facts = await lookupPackages(requested.map((request) => request.name))
  return facts.find((fact) => !fact.exists)?.name ?? null
}

/** Checks explicit installs against the dependency ranges already declared by the workspace. */
export async function firstDowngradingInstallTarget(
  command: string,
  packageJson: string | null,
  lookupPackage: (name: string) => Promise<InstallPackageFacts>,
): Promise<InstallRefusal | null> {
  if (!packageJson) return null
  const targets = requestedInstallVersions(command)
  if (targets.length === 0) return null

  let manifest: unknown
  try {
    manifest = JSON.parse(packageJson)
  } catch {
    return null
  }

  const declaredRanges: Record<string, string> = {}
  for (const dependency of declaredDependencies(manifest)) declaredRanges[dependency.name] = dependency.range
  const downgrade = findManifestDowngrades(targets, declaredRanges)[0]
  if (!downgrade) return null

  const latest = (await lookupPackage(downgrade.name)).latest
  return { refusal: buildInstallDowngradeRefusal(downgrade, latest), name: downgrade.name }
}

/** Checks explicit installs against registry existence, published ranges, and stale majors. */
export async function firstInvalidRegistryInstallTarget(
  command: string,
  packageJson: string | null,
  lookupPackages: LookupPackages,
): Promise<RegistryInstallRefusal | null> {
  const targets = requestedInstallVersions(command)
  if (targets.length === 0) return null

  const facts = await lookupPackages(targets.map((target) => target.name))
  const declaredRanges: Record<string, string> = {}
  if (packageJson) {
    try {
      for (const dependency of declaredDependencies(JSON.parse(packageJson))) {
        declaredRanges[dependency.name] = dependency.range
      }
    } catch {
      // A malformed manifest cannot establish an existing compatibility constraint.
    }
  }

  const issue = findRegistryInstallIssue(targets, declaredRanges, facts)
  return issue ? { refusal: buildRegistryInstallRefusal(issue), name: issue.name, kind: issue.kind } : null
}
