

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

/** Extracts the conflict from a failed install's output, or null when the output is not an ERESOLVE failure or is too incomplete to act on. */
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

/** What to tell the model when an install fails on a peer conflict. */
/** The one range the command can actually carry, out of what npm printed. */
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
