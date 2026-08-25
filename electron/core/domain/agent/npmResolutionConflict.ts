/**
 * npm Resolution Conflict (ERESOLVE).
 *
 * Turns npm's dependency-tree failure into the one thing the model needs and cannot infer:
 * which two versions are in conflict, and the concrete command that ends it.
 *
 * This is the first failure the agent hit once it could see errors at all. In two consecutive
 * live runs the model wrote a `package.json` pinning `vite@^4`, then — correctly prompted by
 * importDeclarationGate — ran `npm install @vitejs/plugin-react`, whose current major
 * peer-requires a far newer vite. npm answered with a precise, well-structured explanation:
 *
 *     npm error Found: vite@4.5.14
 *     npm error   dev vite@"^4.2.3" from the root project
 *     npm error Could not resolve dependency:
 *     npm error peer vite@"^8.0.0" from @vitejs/plugin-react@6.1.0
 *
 * and the generic auto-healing directive on top of it said "locate the failing file, syntax, or
 * command parameter" — none of which is the problem. The model re-ran the same install, failed
 * identically, and the milestone was abandoned. Nothing was wrong with a file.
 *
 * Everything the fix needs is already in that output, so it is parsed rather than guessed: the
 * version ranges in the directive below are copied verbatim from npm, never synthesised.
 *
 * Pure domain: text in, verdict out.
 */

import { majorOf } from './dependencyVersionReality'

/** The two sides of an ERESOLVE peer conflict, as npm reported them. */
export interface NpmResolutionConflict {
  /** The package already resolved in the tree, and the version npm found. */
  installed: { name: string; version: string }
  /** The range the manifest declares for it, when npm named one ("^4.2.3"). */
  declaredRange?: string
  /** Which manifest section that declaration sits in, when npm said so. */
  declaredScope?: 'dev' | 'peer' | 'optional' | 'prod'
  /** The range the incoming package demands ("^8.0.0"). */
  requiredRange: string
  /** The package demanding it. */
  requiredBy: { name: string; version?: string }
}

/** npm 9 prefixes error lines with `npm ERR!`, npm 10+ with `npm error`. */
const NPM_PREFIX = /^\s*npm\s+(?:ERR!|error)\s?/i

/** `Found: vite@4.5.14` — the version already in the tree. */
const FOUND_LINE = /^Found:\s+(@?[^\s@]+(?:\/[^\s@]+)?)@(\S+)/

/** `dev vite@"^4.2.3" from the root project` — what the manifest asks for. */
const DECLARED_LINE = /^(dev|peer|optional)?\s*(@?[^\s@]+(?:\/[^\s@]+)?)@"([^"]+)"\s+from\s+the\s+root\s+project/

/** `peer vite@"^8.0.0" from @vitejs/plugin-react@6.1.0` — what the incoming package demands. */
const REQUIRED_LINE = /^(?:peer\s+)?(@?[^\s@]+(?:\/[^\s@]+)?)@"([^"]+)"\s+from\s+(@?[^\s@]+(?:\/[^\s@]+)?)(?:@(\S+))?/

function stripNpmPrefixes(output: string): string[] {
  return output
    .split(/\r?\n/)
    .filter((line) => NPM_PREFIX.test(line))
    .map((line) => line.replace(NPM_PREFIX, '').trim())
}

/**
 * Extracts the conflict from a failed install's output, or null when the output is not an
 * ERESOLVE failure or is too incomplete to act on.
 *
 * Requires both halves — the version that is installed and the version that is demanded —
 * because a directive naming only one of them is no better than the generic message it
 * replaces.
 */
export function parseNpmResolutionConflict(output: string): NpmResolutionConflict | null {
  if (!output || !/ERESOLVE/i.test(output)) return null

  const lines = stripNpmPrefixes(output)
  if (lines.length === 0) return null

  let installed: { name: string; version: string } | null = null
  let declaredRange: string | undefined
  let declaredScope: NpmResolutionConflict['declaredScope']
  let required: NpmResolutionConflict | null = null

  for (const line of lines) {
    const found = FOUND_LINE.exec(line)
    if (found && !installed) {
      installed = { name: found[1], version: found[2] }
      continue
    }

    const declared = DECLARED_LINE.exec(line)
    if (declared && installed && declared[2] === installed.name && !declaredRange) {
      declaredScope = (declared[1] as NpmResolutionConflict['declaredScope']) || 'prod'
      declaredRange = declared[3]
      continue
    }

    // Only the line that constrains the SAME package as `Found:` describes this conflict; the
    // block also lists the incoming package's own root declaration (`@vitejs/plugin-react@"*"`).
    const req = REQUIRED_LINE.exec(line)
    if (req && installed && req[1] === installed.name && req[3] !== 'the' && !required) {
      required = {
        installed,
        requiredRange: req[2],
        requiredBy: { name: req[3], version: req[4] },
      }
    }
  }

  if (!installed || !required) return null
  return { ...required, declaredRange, declaredScope }
}

function describeRequirer(conflict: NpmResolutionConflict): string {
  const { name, version } = conflict.requiredBy
  return version ? `${name}@${version}` : name
}

/**
 * What to tell the model when an install fails on a peer conflict.
 *
 * Written as one instruction with one fallback, never as a menu. An earlier draft laid out two
 * options and said "pick ONE and run it now"; in the live probe the model read it, understood
 * it, and then called `ask` to put the choice back to the user — quoting both options verbatim
 * in its question. In AGENT mode there is nobody to answer, so the session ended there. A
 * directive that offers a model a decision invites it to escalate the decision.
 *
 * Both escapes npm itself offers — `--force` and `--legacy-peer-deps` — install the tree anyway
 * and leave a project that fails when it runs. They are named only so the model recognises them
 * as the wrong move when it meets them in npm's own output, which is where it would otherwise
 * pick them up.
 *
 * The upgrade command carries the range exactly as npm printed it, unquoted: the model dropped
 * the version spec from a shell-quoted `pkg@"^8.0.0"` and ran a bare `npm install pkg`, which
 * changes nothing.
 */
/**
 * The one range the command can actually carry, out of what npm printed.
 *
 * A peer requirement is often a list of alternatives — run 13 of 2026-08-25 hit
 * `eslint@"^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9.7"` — and copying that into a command hands
 * the shell its own OR operator: `npm install eslint@^3` runs, then the shell tries to execute
 * `^4` as a program. That run ended with an empty `node_modules/.bin` and a build that could not
 * find `tsc`.
 *
 * Quoting would fix the shell and keep the ambiguity; one alternative removes both. The
 * alternative must not be below the version already in the tree: the measured React 18 case
 * turned a transitive React 16 peer into a root downgrade, which the executor then refused on
 * every turn while this directive kept ordering it.
 */
export function installableRange(requiredRange: string, installedVersion?: string): string | null {
  const alternatives = (requiredRange || '')
    .split('||')
    .map((part) => part.trim())
    .filter(Boolean)
  const installedMajor = installedVersion ? majorOf(installedVersion) : null
  const nonDowngrading = alternatives.filter((candidate) => {
    if (installedMajor === null) return true
    // Caret, tilde and exact major selectors cap compatibility to that major. Comparator
    // ranges such as ">=7" remain eligible because they also admit the installed major.
    if (!/^[~^]?\d/.test(candidate)) return true
    const candidateMajor = majorOf(candidate)
    return candidateMajor === null || candidateMajor >= installedMajor
  })
  if (nonDowngrading.length === 0) return null
  if (nonDowngrading.length === 1) return nonDowngrading[0].replace(/\s+/g, '')

  return nonDowngrading
    .reduce((best, candidate) => (Number(majorOf(candidate) ?? -1) > Number(majorOf(best) ?? -1) ? candidate : best))
    .replace(/\s+/g, '')
}

export function buildNpmResolutionDirective(conflict: NpmResolutionConflict): string {
  const installedLabel = `${conflict.installed.name}@${conflict.installed.version}`
  const requirer = describeRequirer(conflict)
  const declaredNote = conflict.declaredRange
    ? ` (package.json declares "${conflict.installed.name}": "${conflict.declaredRange}"${
        conflict.declaredScope && conflict.declaredScope !== 'prod' ? ` under ${conflict.declaredScope}Dependencies` : ''
      })`
    : ''
  const targetRange = installableRange(conflict.requiredRange, conflict.installed.version)

  if (!targetRange) {
    return [
      '[DEPENDENCY VERSION CONFLICT — ROOT DOWNGRADE REFUSED]',
      `${installedLabel} is in the tree${declaredNote}, but ${requirer} requires ${conflict.installed.name}@${conflict.requiredRange}.`,
      `Every explicit compatible branch is below the installed ${conflict.installed.name} major. Keep ${installedLabel}; changing the root dependency would downgrade the project to satisfy the package that does not fit.`,
      '',
      'Do this now, exactly:',
      `     npm view ${conflict.requiredBy.name} versions --json`,
      `Then install a version of ${conflict.requiredBy.name} whose peer dependencies support ${conflict.installed.name}@${conflict.installed.version}, or remove ${conflict.requiredBy.name} if none does.`,
      '',
      `Do NOT downgrade ${conflict.installed.name}, and never use --force or --legacy-peer-deps: they install a mismatched tree anyway.`,
    ].join('\n')
  }

  const upgradeCommand = `npm install ${conflict.installed.name}@${targetRange}`

  return [
    '[DEPENDENCY VERSION CONFLICT — ERESOLVE]',
    `${installedLabel} is in the tree${declaredNote}, but ${requirer} requires ${conflict.installed.name}@${conflict.requiredRange}.`,
    'This is a VERSION mismatch. No file in the workspace is wrong, so do not edit source files, and do not ask the user which version to use — decide and act.',
    '',
    'Do this now, exactly:',
    `     ${upgradeCommand}`,
    `That moves ${conflict.installed.name} to the range ${conflict.requiredBy.name} needs. Include the version — a bare "npm install ${conflict.installed.name}" changes nothing.`,
    '',
    `Only if that command also fails: keep ${installedLabel} instead and downgrade the other side, listing the candidates first with "npm view ${conflict.requiredBy.name} versions --json".`,
    '',
    'Never re-run the failed command unchanged, and never use --force or --legacy-peer-deps: they install the mismatched tree anyway and the project then fails when it runs.',
  ].join('\n')
}

/** Convenience for the executor: the directive for this output, or '' when it is not an ERESOLVE failure. */
export function npmResolutionDirectiveFor(output: string): string {
  const conflict = parseNpmResolutionConflict(output)
  return conflict ? `\n\n${buildNpmResolutionDirective(conflict)}` : ''
}
