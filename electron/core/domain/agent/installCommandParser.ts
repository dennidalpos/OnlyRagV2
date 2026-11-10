/** The shape this module needs from a recorded step; matches EpisodicStepRecord. */
export interface InstallAttemptRecord {
  tool: string
  target?: string
  status: 'SUCCESS' | 'FAILURE' | 'BLOCKED'
  /** Stable executor result summary; carries an authoritative preflight registry refusal. */
  summary?: string
}

export interface RequestedPackage {
  name: string
  hasExplicitVersion: boolean
}

/** The package names an install-with-explicit-targets command names, flags and version specifiers stripped. */
export function extractRequestedPackages(command: string): RequestedPackage[] {
  const match = (command || '').trim().match(/^(?:npm|pnpm|yarn|bun)\s+(?:install|i|add)\b(.*)$/i)
  if (!match) return []
  return match[1]
    .split(/\s+/)
    .filter((tok) => tok && !tok.startsWith('-'))
    .map((tok) => {
      // Scoped package ("@scope/name@version"): keep the scope, strip only a trailing version.
      const versionSplitIndex = tok.startsWith('@') ? tok.indexOf('@', 1) : tok.indexOf('@')
      return versionSplitIndex > 0 ? { name: tok.slice(0, versionSplitIndex), hasExplicitVersion: true } : { name: tok, hasExplicitVersion: false }
    })
}

/** A failed install is not the same thing as an impossible package, and treating them alike cost a whole live run. */
const FAILURES_BEFORE_UNINSTALLABLE = 2

/** Packages this session has attempted at least twice and never installed, sorted. */
export function packagesWithFailedInstall(episodes: readonly InstallAttemptRecord[]): string[] {
  const failures = new Map<string, number>()

  for (const episode of episodes || []) {
    if (episode.tool !== 'run_command') continue
    const packages = extractRequestedPackages(episode.target || '')
    if (packages.length === 0) continue
    const registryRefusal = /^Install refused: (.+) does not exist on npm$/.exec(episode.summary || '')

    for (const pkg of packages) {
      if (episode.status === 'FAILURE') {
        const incremented = (failures.get(pkg.name) ?? 0) + 1
        failures.set(pkg.name, registryRefusal?.[1] === pkg.name ? FAILURES_BEFORE_UNINSTALLABLE : incremented)
      } else if (episode.status === 'SUCCESS') failures.set(pkg.name, 0)
    }
  }

  return Array.from(failures.entries())
    .filter(([, count]) => count >= FAILURES_BEFORE_UNINSTALLABLE)
    .map(([name]) => name)
    .sort()
}
