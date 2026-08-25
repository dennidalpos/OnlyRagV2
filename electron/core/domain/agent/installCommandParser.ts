/**
 * Install Command Parser.
 *
 * Reads package names out of an install command, and reads out of a session's trajectory which
 * of those installs have already failed.
 *
 * The parsing half lived privately inside agentToolExecutorService.ts, where the redundant
 * install guard uses it. It is here because a second caller now needs exactly the same answer,
 * and two copies of "what does `npm i -D pkg@^1.2.3` name?" would drift apart in a week.
 *
 * The trajectory half is new, and it exists because of a loop this project measured. In the
 * live run of 2026-08-24 the model wrote a file importing `@tailwindcss/react` — a package that
 * does not exist on npm. The `dependencies_undeclared` directive correctly ordered
 * `npm install @tailwindcss/react`; the install failed; the directive is recomputed from disk
 * every turn, so the next prompt ordered the same command again. Thirteen steps of a session
 * went into an install that could never succeed. The directive already carried the way out in
 * its text — "if the package does not exist, rewrite the file that imports it" — but it was
 * directive 2 under an imperative directive 1, and a model follows the first. An escape has to
 * become THE instruction once the first one has demonstrably failed.
 *
 * Pure domain: the caller supplies the episodes.
 */

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

/**
 * The package names an install-with-explicit-targets command names, flags and version
 * specifiers stripped.
 *
 * Returns an empty array for a bare `npm install` / `npm ci` — no explicit targets, and it
 * legitimately reinstalls from the lockfile every time — and for any non-install command.
 */
export function extractRequestedPackages(command: string): RequestedPackage[] {
  const match = (command || '').trim().match(/^(?:npm|pnpm|yarn|bun)\s+(?:install|i|add)\b(.*)$/i)
  if (!match) return []
  return match[1]
    .split(/\s+/)
    .filter((tok) => tok && !tok.startsWith('-'))
    .map((tok) => {
      // Scoped package ("@scope/name@version"): keep the scope, strip only a trailing version.
      const versionSplitIndex = tok.startsWith('@') ? tok.indexOf('@', 1) : tok.indexOf('@')
      return versionSplitIndex > 0
        ? { name: tok.slice(0, versionSplitIndex), hasExplicitVersion: true }
        : { name: tok, hasExplicitVersion: false }
    })
}

/**
 * A failed install is not the same thing as an impossible package, and treating them alike
 * cost a whole live run.
 *
 * First attempt at this counted ONE failure as proof the name could not be installed. On
 * 2026-08-24 that made the arbiter tell the model, for forty-five consecutive steps, to remove
 * `@vitejs/plugin-react` from `vite.config.ts` — a real package the project needs — under a
 * sentence asserting that the name does not resolve on the registry. It had failed once, on an
 * ERESOLVE version conflict, which is precisely the case the recovery of blueprint §5.3 exists
 * to fix: install the version npm names, then retry. The rule killed that recovery and stated
 * something untrue while doing it.
 *
 * Two ordinary failures with no success in between is what actually separates the two cases, and the
 * separation is visible in the runs rather than assumed: a real package in conflict fails once
 * and then succeeds after the recovery command; an invented name (`@tailwindcss/react`, which
 * does not exist on npm) fails every single time it is attempted. The exception is the executor's
 * preflight registry refusal: it is already an HTTP 404 fact, not an inference from npm failure,
 * so requiring the same lookup twice only repeats a command known to be impossible.
 */
const FAILURES_BEFORE_UNINSTALLABLE = 2

/**
 * Packages this session has attempted at least twice and never installed, sorted.
 *
 * A SUCCESS resets the count to zero rather than merely clearing a flag: a package that failed,
 * recovered and installed is installed, and a later unrelated failure should start counting
 * again from scratch.
 *
 * BLOCKED is not a failure of the install: it is the loop guard refusing to run it again, and
 * counting it would let guard interventions alone condemn a package the registry never refused.
 */
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
      }
      else if (episode.status === 'SUCCESS') failures.set(pkg.name, 0)
    }
  }

  return Array.from(failures.entries())
    .filter(([, count]) => count >= FAILURES_BEFORE_UNINSTALLABLE)
    .map(([name]) => name)
    .sort()
}
