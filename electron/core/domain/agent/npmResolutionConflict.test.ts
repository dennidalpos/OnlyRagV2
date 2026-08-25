import { describe, expect, it } from 'vitest'
import {
  buildNpmResolutionDirective,
  npmResolutionDirectiveFor,
  parseNpmResolutionConflict,
  installableRange,
} from './npmResolutionConflict'

/** Verbatim from the live run of 2026-08-24 (npm 10 "npm error" prefix). */
const REAL_ERESOLVE_OUTPUT = `npm error code ERESOLVE
npm error ERESOLVE unable to resolve dependency tree
npm error
npm error While resolving: project-dashboard-task@1.0.0
npm error Found: vite@4.5.14
npm error node_modules/vite
npm error   dev vite@"^4.2.3" from the root project
npm error
npm error Could not resolve dependency:
npm error peer vite@"^8.0.0" from @vitejs/plugin-react@6.1.0
npm error node_modules/@vitejs/plugin-react
npm error   @vitejs/plugin-react@"*" from the root project
npm error
npm error Fix the upstream dependency conflict, or retry this command with --force or --legacy-peer-deps to accept an incorrect (and potentially broken) dependency resolution.
npm error
npm error For a full report see:
npm error C:\\Users\\Utente\\AppData\\Local\\npm-cache\\_logs\\2026-08-24T10_56_11_803Z-eresolve-report.txt`

/** Same failure as npm 9 reported it, to keep both prefixes covered. */
const NPM9_ERESOLVE_OUTPUT = REAL_ERESOLVE_OUTPUT.replace(/npm error/g, 'npm ERR!')

describe('parseNpmResolutionConflict', () => {
  it('reads both sides of the conflict out of npm\'s own report', () => {
    const conflict = parseNpmResolutionConflict(REAL_ERESOLVE_OUTPUT)

    expect(conflict).not.toBeNull()
    expect(conflict?.installed).toEqual({ name: 'vite', version: '4.5.14' })
    expect(conflict?.declaredRange).toBe('^4.2.3')
    expect(conflict?.declaredScope).toBe('dev')
    expect(conflict?.requiredRange).toBe('^8.0.0')
    expect(conflict?.requiredBy).toEqual({ name: '@vitejs/plugin-react', version: '6.1.0' })
  })

  it('handles the npm 9 "npm ERR!" prefix identically', () => {
    expect(parseNpmResolutionConflict(NPM9_ERESOLVE_OUTPUT)).toEqual(
      parseNpmResolutionConflict(REAL_ERESOLVE_OUTPUT)
    )
  })

  it('does not confuse the incoming package\'s own root declaration with the constraint', () => {
    // `@vitejs/plugin-react@"*" from the root project` sits in the same block and matches the
    // same line shape; only the line constraining the package named by `Found:` counts.
    const conflict = parseNpmResolutionConflict(REAL_ERESOLVE_OUTPUT)
    expect(conflict?.requiredRange).not.toBe('*')
  })

  it('returns null for output that is not an ERESOLVE failure', () => {
    expect(parseNpmResolutionConflict('npm error code ENOENT\nnpm error missing script: build')).toBeNull()
    expect(parseNpmResolutionConflict('')).toBeNull()
  })

  it('returns null when the report names only one side', () => {
    const truncated = `npm error code ERESOLVE
npm error ERESOLVE unable to resolve dependency tree
npm error Found: vite@4.5.14`
    expect(parseNpmResolutionConflict(truncated)).toBeNull()
  })
})

describe('buildNpmResolutionDirective', () => {
  const conflict = parseNpmResolutionConflict(REAL_ERESOLVE_OUTPUT)!

  it('names both versions and gives a command copied from npm\'s own range', () => {
    const directive = buildNpmResolutionDirective(conflict)

    expect(directive).toContain('vite@4.5.14')
    expect(directive).toContain('@vitejs/plugin-react@6.1.0')
    expect(directive).toContain('npm install vite@^8.0.0')
    expect(directive).toContain('npm view @vitejs/plugin-react versions --json')
    expect(directive).toContain('devDependencies')
  })

  it('gives one instruction and a fallback, never a menu the model can escalate', () => {
    // The first draft said "Pick ONE of these and run it now"; in the live probe the model
    // answered by calling `ask` and quoting both options back at a user who was not there.
    const directive = buildNpmResolutionDirective(conflict)
    expect(directive).toContain('Do this now, exactly:')
    expect(directive).not.toMatch(/pick one/i)
    expect(directive).toMatch(/do not ask the user/i)
  })

  it('keeps the version spec attached and unquoted so it survives being retyped', () => {
    // The model dropped the spec from `vite@"^8.0.0"` and ran a bare `npm install vite`.
    const directive = buildNpmResolutionDirective(conflict)
    expect(directive).toContain('npm install vite@^8.0.0')
    expect(directive).toMatch(/a bare "npm install vite" changes nothing/i)
  })

  it('steers the model away from the two escapes npm advertises', () => {
    const directive = buildNpmResolutionDirective(conflict)
    expect(directive).toContain('--legacy-peer-deps')
    expect(directive).toMatch(/never use --force/i)
  })

  it('says the fix is not in the source files', () => {
    // The generic auto-healing directive told the model to "locate the failing file, syntax,
    // or command parameter" — which sent it rewriting files that were never the problem.
    expect(buildNpmResolutionDirective(conflict)).toMatch(/do not edit source files/i)
  })
})

describe('npmResolutionDirectiveFor', () => {
  it('returns an appendable block for a conflict and an empty string otherwise', () => {
    expect(npmResolutionDirectiveFor(REAL_ERESOLVE_OUTPUT)).toContain('[DEPENDENCY VERSION CONFLICT — ERESOLVE]')
    expect(npmResolutionDirectiveFor(REAL_ERESOLVE_OUTPUT).startsWith('\n\n')).toBe(true)
    expect(npmResolutionDirectiveFor('build succeeded')).toBe('')
  })
})

describe('installableRange', () => {
  it('picks the highest alternative, so the shell never sees an OR operator', () => {
    // Run 13 of 2026-08-25 ran `npm install eslint@^3 || ^4 || ... || ^9.7`: the shell executed
    // the first install and then tried to run `^4` as a program. node_modules/.bin ended empty
    // and the build could not find tsc.
    expect(installableRange('^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9.7')).toBe('^9.7')
  })

  it('leaves an ordinary single range alone', () => {
    expect(installableRange('^8.0.0')).toBe('^8.0.0')
    expect(installableRange('>= 7.0.0')).toBe('>=7.0.0')
  })

  it('produces a command with no shell operator in it', () => {
    const directive = buildNpmResolutionDirective({
      installed: { name: 'eslint', version: '9.7.0' },
      requiredBy: { name: 'eslint-plugin-react', version: '7.32.2' },
      requiredRange: '^3 || ^4 || ^9.7',
    } as any)

    expect(directive).toContain('npm install eslint@^9.7')
    expect(directive).not.toContain('npm install eslint@^3 ||')
  })
})
